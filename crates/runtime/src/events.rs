use crate::protocol::{Event, SubscriptionScope};
use std::sync::{Arc, Mutex};
use tokio::sync::{Notify, mpsc};

/// A bounded FIFO plus one latest event. Overflow preserves a final cursor so clients
/// can detect skipped events and reread authoritative state even when a turn stops.
pub struct EventReceiver {
    queue: mpsc::Receiver<Event>,
    overflow: Arc<Mutex<Option<Event>>>,
    wake: Arc<Notify>,
}

pub(crate) struct Subscriber {
    pub scope: SubscriptionScope,
    sender: mpsc::Sender<Event>,
    overflow: Arc<Mutex<Option<Event>>>,
    wake: Arc<Notify>,
}

pub(crate) fn channel(scope: SubscriptionScope) -> (Subscriber, EventReceiver) {
    let (sender, queue) = mpsc::channel(256);
    let overflow = Arc::new(Mutex::new(None));
    let wake = Arc::new(Notify::new());
    (
        Subscriber {
            scope,
            sender,
            overflow: Arc::clone(&overflow),
            wake: Arc::clone(&wake),
        },
        EventReceiver {
            queue,
            overflow,
            wake,
        },
    )
}

impl Subscriber {
    pub fn is_closed(&self) -> bool {
        self.sender.is_closed()
    }

    pub fn deliver(&self, event: Event) -> bool {
        let Ok(mut overflow) = self.overflow.lock() else {
            return false;
        };
        if self.sender.is_closed() {
            return false;
        }
        if overflow.is_some() {
            *overflow = Some(event);
            self.wake.notify_one();
            return true;
        }
        match self.sender.try_send(event) {
            Ok(()) => true,
            Err(mpsc::error::TrySendError::Full(event)) => {
                *overflow = Some(event);
                self.wake.notify_one();
                true
            }
            Err(mpsc::error::TrySendError::Closed(_)) => false,
        }
    }
}

impl EventReceiver {
    fn latest(&self) -> Option<Event> {
        self.overflow.lock().ok()?.take()
    }

    pub async fn recv(&mut self) -> Option<Event> {
        loop {
            match self.queue.try_recv() {
                Ok(event) => return Some(event),
                Err(mpsc::error::TryRecvError::Disconnected) => return self.latest(),
                Err(mpsc::error::TryRecvError::Empty) => {}
            }
            if let Some(event) = self.latest() {
                return Some(event);
            }
            tokio::select! {
                event = self.queue.recv() => return event.or_else(|| self.latest()),
                _ = self.wake.notified() => {}
            }
        }
    }

    pub fn try_recv(&mut self) -> Result<Event, mpsc::error::TryRecvError> {
        self.queue
            .try_recv()
            .or_else(|error| self.latest().ok_or(error))
    }
}
