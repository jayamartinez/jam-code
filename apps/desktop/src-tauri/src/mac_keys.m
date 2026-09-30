#import <AppKit/AppKit.h>

// AppKit reads ⌘. as "cancel" before a web view sees the key. A local monitor
// runs first, so ⌘. in JAM's window goes to the page instead. It matches the
// character, as AppKit does, so the keypad's period counts too. Panels and
// sheets (Open, Save) keep ⌘. as their Cancel.
static id commandPeriodMonitor;

void jam_forward_command_period(void (*callback)(bool shift, bool control, bool option)) {
    if (commandPeriodMonitor) return;
    commandPeriodMonitor = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                     handler:^NSEvent *(NSEvent *event) {
                                       NSEventModifierFlags flags =
                                           event.modifierFlags &
                                           NSEventModifierFlagDeviceIndependentFlagsMask;
                                       NSWindow *window = event.window;
                                       if (!(flags & NSEventModifierFlagCommand) ||
                                           ![event.charactersIgnoringModifiers
                                               isEqualToString:@"."] ||
                                           !window || [window isKindOfClass:NSPanel.class] ||
                                           window.attachedSheet)
                                           return event;
                                       callback(flags & NSEventModifierFlagShift,
                                                flags & NSEventModifierFlagControl,
                                                flags & NSEventModifierFlagOption);
                                       return nil;
                                     }];
}
