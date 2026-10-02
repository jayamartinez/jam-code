//! Files attached to chats: copied into JAM's own storage, staged, moved
//! into their conversation's folder when sent, handed to every agent by the
//! path of that copy, kept with the transcript and cleaned up. A scripted
//! adapter stands in for a real provider and records exactly what it was given.
use jam_runtime::{
    Runtime,
    attachments::limits,
    protocol::{
        CapabilitySupport, EventPayload, MessageBlock, ProviderDescriptor, ProviderModel, Request,
        SessionStatus, SubscriptionScope,
    },
    providers::{
        MockProvider, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
        ProviderUpdate, TurnIo,
    },
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR-not-a-real-image";
const PDF: &[u8] = b"%PDF-1.7\n\xe2\xe3\xcf\xd3 binary body";

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-attach-{}", uuid::Uuid::new_v4()));
        for folder in ["data", "project", "downloads"] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        Self(root)
    }
    fn db(&self) -> PathBuf {
        self.0.join("data").join("jam.sqlite")
    }
    fn attachments(&self) -> PathBuf {
        self.0.join("data").join("attachments")
    }
    /// Every file in JAM's attachment folder, as `folder/name` or `name`.
    fn stored(&self) -> Vec<String> {
        fn walk(folder: &Path, prefix: &str, found: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(folder) else {
                return;
            };
            for entry in entries {
                let entry = entry.unwrap();
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().unwrap().is_dir() {
                    walk(&entry.path(), &format!("{prefix}{name}/"), found);
                } else {
                    found.push(format!("{prefix}{name}"));
                }
            }
        }
        let mut found = Vec::new();
        walk(&self.attachments(), "", &mut found);
        found.sort();
        found
    }
    /// The folders in JAM's attachment folder: one per conversation that sent any.
    fn folders(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(self.attachments())
            .map(|entries| {
                entries
                    .map(|entry| entry.unwrap())
                    .filter(|entry| entry.file_type().unwrap().is_dir())
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
    /// A file somewhere the reader keeps files, outside the project and JAM.
    fn chosen(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join("downloads").join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
    fn rows(&self, filter: &str) -> i64 {
        rusqlite::Connection::open(self.db())
            .unwrap()
            .query_row(
                &format!("SELECT count(*) FROM attachments WHERE {filter}"),
                [],
                |row| row.get(0),
            )
            .unwrap()
    }
    /// Everything the database holds, to look for something that must not be there.
    fn dump(&self) -> String {
        let db = rusqlite::Connection::open(self.db()).unwrap();
        let mut all = String::new();
        for (table, column) in [
            ("attachments", "data"),
            ("messages", "data"),
            ("search_documents", "body"),
            ("requests", "receipt"),
            ("requests", "fingerprint"),
        ] {
            let mut statement = db
                .prepare(&format!("SELECT {column} FROM {table}"))
                .unwrap();
            for row in statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
            {
                all.push_str(&row.unwrap());
                all.push('\n');
            }
        }
        all
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// What one turn gave the provider.
#[derive(Clone, Debug)]
struct Given {
    text: String,
    /// Name and the path of JAM's copy, for every attached file.
    files: Vec<(String, PathBuf)>,
    /// Media type, label, and the file a disk-reading provider is pointed at.
    images: Vec<(String, String, Option<PathBuf>)>,
    image_bytes: Vec<Vec<u8>>,
    /// The one folder the agent is told it may read attachments from.
    attachment_dir: Option<PathBuf>,
}

struct Scripted {
    given: Arc<Mutex<Vec<Given>>>,
    /// What the model says about images.
    images: &'static str,
}

impl Scripted {
    fn new(images: &'static str) -> Arc<Self> {
        Arc::new(Self {
            given: Arc::default(),
            images,
        })
    }
    fn last(&self) -> Given {
        self.given.lock().unwrap().last().unwrap().clone()
    }
}

impl ProviderAdapter for Scripted {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn unchecked(&self, config: &ProviderConfig) -> ProviderDescriptor {
        let mut descriptor = MockProvider.unchecked(config);
        descriptor.id = "claude".into();
        descriptor.name = "Scripted".into();
        descriptor.installation = "installed".into();
        descriptor.authentication = "authenticated".into();
        descriptor.enabled = true;
        for support in descriptor.capabilities.values_mut() {
            *support = CapabilitySupport::supported();
        }
        descriptor.models = Some(vec![ProviderModel {
            id: "model".into(),
            label: "Model".into(),
            description: None,
            is_default: true,
            efforts: Vec::new(),
            default_effort: None,
            speeds: Vec::new(),
            legacy: false,
            images: Some(self.images.into()),
        }]);
        descriptor
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        let given = Arc::clone(&self.given);
        Box::pin(async move {
            given.lock().unwrap().push(Given {
                text: turn.text.clone(),
                files: turn
                    .files
                    .iter()
                    .map(|file| (file.name.clone(), file.path.clone()))
                    .collect(),
                images: turn
                    .images
                    .iter()
                    .map(|image| {
                        (
                            image.media_type.clone(),
                            image.label.clone(),
                            image.path.clone(),
                        )
                    })
                    .collect(),
                image_bytes: turn
                    .images
                    .iter()
                    .map(|image| image.bytes.to_vec())
                    .collect(),
                attachment_dir: turn.attachment_dir.clone(),
            });
            let _ = io
                .updates
                .send(ProviderUpdate::Blocks(vec![MessageBlock::Text {
                    text: "done".into(),
                }]))
                .await;
            let _ = io
                .updates
                .send(ProviderUpdate::Finished(SessionStatus::Idle))
                .await;
            Ok(())
        })
    }
}

fn open(temp: &Temp, agent: Arc<Scripted>) -> Arc<Runtime> {
    let runtime = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider), agent]).unwrap();
    request(
        &runtime,
        "project.update",
        json!({"projectId":"project-jam","paths":[temp.0.join("project").display().to_string()]}),
    )
    .unwrap();
    runtime
}

fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
    runtime
        .request(Request {
            protocol_version: 1,
            method: method.into(),
            params,
        })
        .map_err(|error| format!("{}: {}", error.code, error.message))
}

fn code(result: Result<Value, String>) -> String {
    result
        .expect_err("refused")
        .split(':')
        .next()
        .unwrap()
        .to_owned()
}

/// A new agent chat, as a first Send creates it.
fn chat(runtime: &Arc<Runtime>, request_id: &str) -> String {
    request(
        runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","requestId":request_id}),
    )
    .unwrap()["resource"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn send(
    runtime: &Arc<Runtime>,
    resource: &str,
    text: &str,
    context: &[Value],
    id: &str,
) -> Result<Value, String> {
    request(
        runtime,
        "turn.start",
        json!({"resourceId":resource,"text":text,"context":context,"requestId":id}),
    )
}

async fn settled(receiver: &mut jam_runtime::EventReceiver) -> SessionStatus {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut started = false;
        while let Some(event) = receiver.recv().await {
            let EventPayload::SessionUpdated { session } = event.payload else {
                continue;
            };
            if session.status == SessionStatus::Running {
                started = true;
            } else if started {
                return session.status;
            }
        }
        panic!("subscription ended before the turn settled")
    })
    .await
    .expect("turn settles")
}

fn item(runtime: &Arc<Runtime>, path: &Path) -> Value {
    serde_json::to_value(runtime.import_attachment(path).unwrap()).unwrap()
}

fn id_of(item: &Value) -> &str {
    item["id"].as_str().unwrap()
}

fn sent_context(runtime: &Arc<Runtime>, resource: &str) -> Vec<Value> {
    request(runtime, "conversation.get", json!({"resourceId":resource})).unwrap()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|message| message["blocks"].as_array().unwrap().clone())
        .filter(|block| block["type"] == "context")
        .flat_map(|block| block["items"].as_array().unwrap().clone())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chosen_file_is_copied_once_and_its_location_is_never_kept() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent.clone());
    let original = temp.chosen("test-output.txt", b"12 passed, 1 failed\n");

    let attached = item(&runtime, &original);
    let id = id_of(&attached).to_owned();
    assert!(id.starts_with("attachment-"));
    assert_eq!(
        attached,
        json!({
            "id": id, "kind": "attachment", "label": "test-output.txt", "source": {}, "assetId": id,
            "attachment": {"name":"test-output.txt","mediaType":"text/plain","kind":"file","bytes":20},
        })
    );
    // The staged copy lives in JAM's folder under its opaque ID, not its name.
    assert_eq!(temp.stored(), vec![format!("{id}.txt")]);
    assert_eq!(temp.rows("sent=0"), 1);

    // The original is not read again: changing or removing it changes nothing.
    std::fs::write(&original, b"tampered after attaching").unwrap();
    std::fs::remove_file(&original).unwrap();
    let resource = chat(&runtime, "create");
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    send(
        &runtime,
        &resource,
        "Why does it fail?",
        &[attached],
        "turn",
    )
    .unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);

    // Sent, the copy is in its conversation's own folder, and the agent is
    // given that copy's path: the way any agent can open any file.
    let copy = temp.attachments().join(&resource).join(format!("{id}.txt"));
    assert_eq!(temp.stored(), vec![format!("{resource}/{id}.txt")]);
    assert_eq!(std::fs::read(&copy).unwrap(), b"12 passed, 1 failed\n");
    let given = agent.last();
    assert_eq!(
        given.text,
        format!(
            "Why does it fail?\n\nFiles attached in JAM (copies saved at these paths; open them as needed):\n- test-output.txt: {}",
            copy.display()
        )
    );
    assert_eq!(
        given.files,
        vec![("test-output.txt".to_owned(), copy.clone())]
    );
    assert_eq!(
        given.attachment_dir,
        Some(temp.attachments().join(&resource))
    );
    // The file is not pasted into the prompt, and nothing is sent as an image.
    assert!(!given.text.contains("12 passed"));
    assert!(given.images.is_empty());

    // Nothing JAM stores, and nothing the provider was given, names where
    // the file came from.
    assert!(!temp.dump().contains("downloads"));
    assert!(!given.text.contains("downloads"));

    // The transcript shows the attachment, and it now belongs to that chat.
    let context = sent_context(&runtime, &resource);
    assert_eq!(context.len(), 1);
    assert_eq!(context[0]["attachment"]["name"], "test-output.txt");
    assert_eq!(temp.rows("sent=1"), 1);
    assert_eq!(
        code(request(&runtime, "attachment.remove", json!({"id":id}))),
        "conflict"
    );

    // A later turn without attachments still lets the agent read that folder.
    send(&runtime, &resource, "And now?", &[], "turn-2").unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    let later = agent.last();
    assert_eq!(later.text, "And now?");
    assert!(later.files.is_empty());
    assert_eq!(
        later.attachment_dir,
        Some(temp.attachments().join(&resource))
    );

    // It survives a restart with its transcript; search finds it by name.
    drop(events);
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = open(&temp, Scripted::new("supported"));
    assert_eq!(sent_context(&reopened, &resource), context);
    assert_eq!(temp.stored(), vec![format!("{resource}/{id}.txt")]);
    assert_eq!(
        request(&reopened, "search.query", json!({"query":"test-output"})).unwrap()["results"][0]["resourceId"],
        json!(resource)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn any_regular_file_within_the_limit_is_attached_as_it_is() {
    let temp = Temp::new();
    let runtime = open(&temp, Scripted::new("supported"));
    let refused = |path: &Path| runtime.import_attachment(path).unwrap_err();

    assert_eq!(
        refused(&temp.0.join("downloads")).message,
        "Folders can't be attached."
    );
    assert_eq!(
        refused(&temp.0.join("downloads/missing.txt")).code,
        "unavailable"
    );
    assert_eq!(
        refused(&temp.chosen("empty.txt", b"")).message,
        "The file is empty."
    );
    // Too large is refused before it is read into memory or stored.
    let huge = vec![b'a'; limits().file_bytes + 1];
    assert!(
        refused(&temp.chosen("huge.log", &huge))
            .message
            .contains("Attachments can be at most 25 MB")
    );
    #[cfg(unix)]
    {
        let target = temp.chosen("target.txt", b"real");
        let link = temp.0.join("downloads/link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(refused(&link).message.contains("That is a link"));
    }
    // Nothing that was refused left a file or a record behind.
    assert_eq!(temp.stored(), Vec::<String>::new());
    assert_eq!(temp.rows("1=1"), 0);

    // A PDF, an archive and anything else are files: kept byte for byte,
    // with their own extension, for the agent to open.
    let utf16: Vec<u8> = [0xff, 0xfe]
        .into_iter()
        .chain("café\n".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    for (name, bytes, media_type, extension) in [
        ("spec.pdf", PDF, "application/pdf", "pdf"),
        (
            "bundle.zip",
            &b"PK\x03\x04\x14\0\0\0\x08\0\xff\xfe"[..],
            "application/zip",
            "zip",
        ),
        ("café notes.log", &utf16[..], "text/plain", "log"),
        (
            "Makefile",
            &b"all:\n\ttrue\n"[..],
            "application/octet-stream",
            "bin",
        ),
    ] {
        let attached = item(&runtime, &temp.chosen(name, bytes));
        assert_eq!(attached["label"], name);
        assert_eq!(
            attached["attachment"],
            json!({"name":name,"mediaType":media_type,"kind":"file","bytes":bytes.len()})
        );
        let copy = temp
            .attachments()
            .join(format!("{}.{extension}", id_of(&attached)));
        assert_eq!(
            std::fs::read(copy).unwrap(),
            bytes,
            "{name} is copied unchanged"
        );
    }
    // An image is typed by content: a PNG named .txt is an image, kept as .png.
    let image = item(&runtime, &temp.chosen("misnamed.txt", PNG));
    assert_eq!(image["attachment"]["kind"], "image");
    assert_eq!(image["attachment"]["mediaType"], "image/png");
    assert!(temp.stored().contains(&format!("{}.png", id_of(&image))));
    // One too large to send natively is still attached, as a file.
    let mut large = PNG.to_vec();
    large.resize(limits().image_bytes + 1, 0);
    let large = item(&runtime, &temp.chosen("large.png", &large));
    assert_eq!(large["attachment"]["kind"], "file");
    assert_eq!(large["attachment"]["mediaType"], "image/png");
}

#[tokio::test(flavor = "multi_thread")]
async fn every_file_type_reaches_the_agent_by_path_and_images_also_natively() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent.clone());
    let resource = chat(&runtime, "create");
    let pdf = item(&runtime, &temp.chosen("spec.pdf", PDF));
    let image = item(&runtime, &temp.chosen("failure.png", PNG));
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    // Context-only: attachments alone are a complete Send.
    send(
        &runtime,
        &resource,
        "",
        &[pdf.clone(), image.clone()],
        "send",
    )
    .unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);

    let folder = temp.attachments().join(&resource);
    let pdf_copy = folder.join(format!("{}.pdf", id_of(&pdf)));
    let image_copy = folder.join(format!("{}.png", id_of(&image)));
    let given = agent.last();
    assert_eq!(
        given.text,
        format!(
            "Files attached in JAM (copies saved at these paths; open them as needed):\n- spec.pdf: {}\n- failure.png: {}",
            pdf_copy.display(),
            image_copy.display()
        )
    );
    assert_eq!(std::fs::read(&pdf_copy).unwrap(), PDF);
    // The image is additionally sent as an image, pointing at the same copy.
    assert_eq!(given.image_bytes, vec![PNG.to_vec()]);
    assert_eq!(
        given.images,
        vec![(
            "image/png".to_owned(),
            "failure.png".to_owned(),
            Some(image_copy)
        )]
    );
    // The PDF is not: no provider documents a native document input today.
    assert_eq!(given.files.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_agent_is_pointed_only_at_its_own_conversations_attachments() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent.clone());
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let (first, second) = (chat(&runtime, "create-1"), chat(&runtime, "create-2"));
    let secret = item(
        &runtime,
        &temp.chosen("first-chat-only.txt", b"private to chat one"),
    );
    send(
        &runtime,
        &first,
        "Read this",
        std::slice::from_ref(&secret),
        "one",
    )
    .unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    assert_eq!(
        agent.last().attachment_dir,
        Some(temp.attachments().join(&first))
    );

    // The other chat has attached nothing: it is given no folder at all, and
    // no path of the first chat's file.
    send(&runtime, &second, "Hello", &[], "two").unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    let other = agent.last();
    assert_eq!(other.attachment_dir, None);
    assert!(other.files.is_empty() && !other.text.contains("first-chat-only"));

    // Once it attaches something it gets its own folder, never the first's.
    let own = item(&runtime, &temp.chosen("second.txt", b"chat two"));
    send(&runtime, &second, "Mine", &[own], "two-b").unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    let other = agent.last();
    assert_eq!(other.attachment_dir, Some(temp.attachments().join(&second)));
    assert!(
        other
            .files
            .iter()
            .all(|(_, path)| path.starts_with(temp.attachments().join(&second)))
    );
    assert_eq!(temp.folders(), {
        let mut folders = vec![first.clone(), second.clone()];
        folders.sort();
        folders
    });
    // A staged file is in neither folder until it is sent.
    let staged = item(&runtime, &temp.chosen("staged.txt", b"waiting"));
    assert!(temp.stored().contains(&format!("{}.txt", id_of(&staged))));
}

#[tokio::test(flavor = "multi_thread")]
async fn assets_are_addressed_by_opaque_id_only() {
    let temp = Temp::new();
    let runtime = open(&temp, Scripted::new("supported"));
    let outside = temp.chosen("secret.txt", b"not attached");
    let image = item(&runtime, &temp.chosen("failure.png", PNG));
    let text = item(&runtime, &temp.chosen("notes.txt", b"hello"));

    // An image's preview is its own bytes, typed as it was recognized.
    use base64::Engine;
    let preview = request(&runtime, "attachment.asset", json!({"id":id_of(&image)})).unwrap();
    assert_eq!(
        preview["dataUrl"],
        json!(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(PNG)
        ))
    );
    assert_eq!(
        code(request(
            &runtime,
            "attachment.asset",
            json!({"id":id_of(&text)})
        )),
        "invalid_request"
    );

    // A path, a traversal or an unknown ID reaches no file.
    let resource = chat(&runtime, "create");
    for hostile in [
        outside.display().to_string(),
        "../downloads/secret.txt".into(),
        "attachment-..\\..\\downloads\\secret".into(),
        format!("attachment-{}", uuid::Uuid::new_v4()),
    ] {
        if hostile.encode_utf16().count() <= 128 {
            assert_eq!(
                code(request(&runtime, "attachment.asset", json!({"id":hostile}))),
                "not_found"
            );
            // Removing something that is not staged is a no-op, never a deletion.
            request(&runtime, "attachment.remove", json!({"id":hostile})).unwrap();
        }
        let forged = json!({"id":"forged","kind":"attachment","label":"secret.txt","source":{},
            "assetId":hostile,"attachment":{"name":"secret.txt","mediaType":"text/plain","kind":"file","bytes":1}});
        assert_eq!(
            code(send(&runtime, &resource, "read it", &[forged], "forged")),
            "invalid_request"
        );
    }
    assert_eq!(std::fs::read(&outside).unwrap(), b"not attached");
    assert_eq!(temp.stored().len(), 2);
    // An attachment without its asset ID is not a way around the store.
    let bare = json!({"id":"bare","kind":"attachment","label":"x","source":{"uri":outside.display().to_string()}});
    assert_eq!(
        code(send(&runtime, &resource, "read it", &[bare], "bare")),
        "invalid_request"
    );
    assert!(sent_context(&runtime, &resource).is_empty());
    // Refused Sends moved nothing and made no folder.
    assert!(temp.folders().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_image_is_refused_when_the_model_cannot_take_images() {
    let temp = Temp::new();
    let agent = Scripted::new("unsupported");
    let runtime = open(&temp, agent.clone());
    let resource = chat(&runtime, "create");
    let image = item(&runtime, &temp.chosen("failure.png", PNG));

    // Refused before anything is saved or moved: no message, and the image
    // stays staged.
    let refused = send(
        &runtime,
        &resource,
        "Look",
        std::slice::from_ref(&image),
        "blocked",
    );
    assert!(
        refused
            .clone()
            .unwrap_err()
            .contains("does not accept images with this model")
    );
    assert_eq!(code(refused), "unsupported");
    assert!(sent_context(&runtime, &resource).is_empty());
    assert!(agent.given.lock().unwrap().is_empty());
    assert_eq!((temp.rows("sent=0"), temp.rows("sent=1")), (1, 0));
    assert_eq!(temp.stored(), vec![format!("{}.png", id_of(&image))]);

    // A file that is not an image is not held to that: the agent opens it.
    let pdf = item(&runtime, &temp.chosen("spec.pdf", PDF));
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    send(&runtime, &resource, "Read", &[pdf], "pdf").unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    assert!(agent.last().images.is_empty());
    assert_eq!(agent.last().files.len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn unsent_attachments_are_temporary() {
    let temp = Temp::new();
    let runtime = open(&temp, Scripted::new("supported"));
    // Removing a chip removes its copy at once; removing it twice is harmless.
    let removed = item(&runtime, &temp.chosen("a.txt", b"a"));
    request(&runtime, "attachment.remove", json!({"id":id_of(&removed)})).unwrap();
    request(&runtime, "attachment.remove", json!({"id":id_of(&removed)})).unwrap();
    assert_eq!((temp.stored().len(), temp.rows("1=1")), (0, 0));
    // The chosen file itself is never deleted.
    assert!(temp.0.join("downloads/a.txt").exists());

    // A chip abandoned past the retention limit goes when the next file is attached.
    let abandoned = item(&runtime, &temp.chosen("old.txt", b"old"));
    let hours = limits().unsent_hours;
    rusqlite::Connection::open(temp.db())
        .unwrap()
        .execute(
            "UPDATE attachments SET created_at = created_at - ?1",
            [(hours * 3_600_000) + 1],
        )
        .unwrap();
    let fresh = item(&runtime, &temp.chosen("new.txt", b"new"));
    assert_eq!(temp.stored(), vec![format!("{}.txt", id_of(&fresh))]);
    // What was staged for a Send that is no longer possible says so.
    let resource = chat(&runtime, "create");
    let error = send(&runtime, &resource, "x", &[abandoned], "stale").unwrap_err();
    assert!(
        error.contains("old.txt is no longer available. Attach it again."),
        "{error}"
    );

    // At most a bounded number wait to be sent.
    for index in 1..limits().unsent_files {
        item(&runtime, &temp.chosen(&format!("f{index}.txt"), b"x"));
    }
    let full = runtime
        .import_attachment(&temp.chosen("one-more.txt", b"x"))
        .unwrap_err();
    assert!(full.message.contains("Too many attachments are waiting"));
    assert_eq!(temp.stored().len(), limits().unsent_files);

    // After a restart nothing is staged, so nothing unsent is kept. A file a
    // crash left without a record goes too, in the root or in a conversation's
    // folder; a file JAM did not name stays.
    let folder = temp.attachments();
    std::fs::write(
        folder.join(format!("attachment-{}.txt", uuid::Uuid::new_v4())),
        b"orphan",
    )
    .unwrap();
    std::fs::create_dir(folder.join("conversation-gone")).unwrap();
    std::fs::write(
        folder
            .join("conversation-gone")
            .join(format!("attachment-{}.pdf", uuid::Uuid::new_v4())),
        b"orphan",
    )
    .unwrap();
    std::fs::write(folder.join("notes.txt"), b"not ours").unwrap();
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let _reopened = open(&temp, Scripted::new("supported"));
    assert_eq!(temp.stored(), vec!["notes.txt".to_owned()]);
    assert!(temp.folders().is_empty());
    assert_eq!(temp.rows("1=1"), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_first_send_with_attachments_is_idempotent_and_an_attachment_is_sent_once() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent.clone());
    let attached = item(&runtime, &temp.chosen("notes.txt", b"remember this"));
    let other = item(&runtime, &temp.chosen("more.txt", b"and this"));

    // New chat, first Send, and its retry after a lost answer.
    let create = json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","requestId":"create"});
    let created = request(&runtime, "conversation.create", create.clone()).unwrap();
    let again = request(&runtime, "conversation.create", create).unwrap();
    assert_eq!(created["resource"]["id"], again["resource"]["id"]);
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let context = [attached.clone(), other.clone()];
    let receipt = send(&runtime, &resource, "Read these", &context, "first").unwrap();
    assert_eq!(
        send(&runtime, &resource, "Read these", &context, "first").unwrap(),
        receipt
    );
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    assert_eq!(
        send(&runtime, &resource, "Read these", &context, "first").unwrap(),
        receipt
    );

    // One conversation, one message, one provider turn, each file sent once.
    assert_eq!(agent.given.lock().unwrap().len(), 1);
    assert_eq!(sent_context(&runtime, &resource).len(), 2);
    assert_eq!((temp.rows("sent=1"), temp.stored().len()), (2, 2));
    assert_eq!(
        agent
            .last()
            .files
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        ["notes.txt", "more.txt"]
    );

    // A sent attachment is one message's: it cannot be sent again, here or
    // in another chat, and the same asset twice in one Send is refused.
    let elsewhere = chat(&runtime, "create-elsewhere");
    for target in [&resource, &elsewhere] {
        let error = send(
            &runtime,
            target,
            "again",
            std::slice::from_ref(&attached),
            "reuse",
        )
        .unwrap_err();
        assert!(error.contains("notes.txt was already sent"), "{error}");
    }
    let twice = item(&runtime, &temp.chosen("twice.txt", b"x"));
    assert_eq!(
        code(send(
            &runtime,
            &elsewhere,
            "x",
            &[twice.clone(), twice],
            "twice"
        )),
        "invalid_request"
    );
    assert!(sent_context(&runtime, &elsewhere).is_empty());

    // What the client claims about an attachment is replaced by the record.
    let mut lying = item(&runtime, &temp.chosen("honest.txt", b"contents"));
    lying["label"] = json!("C:\\Users\\someone\\secret.txt");
    lying["attachment"]["name"] = json!("../../etc/passwd");
    lying["attachment"]["bytes"] = json!(1);
    send(&runtime, &elsewhere, "x", &[lying], "lying").unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    let shown = sent_context(&runtime, &elsewhere);
    assert_eq!(shown[0]["label"], "honest.txt");
    assert_eq!(
        shown[0]["attachment"],
        json!({"name":"honest.txt","mediaType":"text/plain","kind":"file","bytes":8})
    );
    let given = agent.last();
    assert!(given.text.contains("- honest.txt: ") && !given.text.contains("passwd"));
}

#[tokio::test(flavor = "multi_thread")]
async fn one_send_carries_a_bounded_amount_of_native_images() {
    let temp = Temp::new();
    let runtime = open(&temp, Scripted::new("supported"));
    let resource = chat(&runtime, "create");
    let mut large = PNG.to_vec();
    large.resize(limits().image_bytes, 0);
    let images: Vec<Value> = (0..3)
        .map(|index| item(&runtime, &temp.chosen(&format!("big{index}.png"), &large)))
        .collect();
    assert!(limits().image_bytes * 3 > limits().turn_image_bytes);
    let error = send(&runtime, &resource, "x", &images, "too-much").unwrap_err();
    assert!(error.contains("at most 12 MB of images"), "{error}");
    // Refused whole: nothing was sent or moved, and all three are still staged.
    assert!(sent_context(&runtime, &resource).is_empty());
    assert_eq!((temp.rows("sent=0"), temp.rows("sent=1")), (3, 0));
    assert!(temp.folders().is_empty());
    // The existing bound on context items still applies to attachments.
    let many: Vec<Value> = (0..17)
        .map(|index| item(&runtime, &temp.chosen(&format!("s{index}.txt"), b"x")))
        .collect();
    assert_eq!(
        code(send(&runtime, &resource, "x", &many, "too-many")),
        "invalid_request"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_chat_removes_its_attachments_and_no_other_chats() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent);
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let mut chats = Vec::new();
    for name in ["doomed", "kept"] {
        let resource = chat(&runtime, &format!("create-{name}"));
        let file = item(&runtime, &temp.chosen(&format!("{name}.pdf"), PDF));
        let image = item(&runtime, &temp.chosen(&format!("{name}.png"), PNG));
        send(
            &runtime,
            &resource,
            "x",
            &[file.clone(), image.clone()],
            name,
        )
        .unwrap();
        assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
        chats.push((resource, file, image));
    }
    let staged = item(&runtime, &temp.chosen("staged.txt", b"not sent yet"));
    assert_eq!(temp.stored().len(), 5);

    // The deleted chat's last turn may take a moment to finish stopping.
    tokio::time::timeout(Duration::from_secs(10), async {
        while request(
            &runtime,
            "conversation.delete",
            json!({"resourceId":chats[0].0}),
        )
        .is_err()
        {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("the chat is deleted");

    // Its folder is gone with everything in it; the other chat's is intact.
    let kept = &chats[1];
    let mut expected = vec![
        format!("{}/{}.pdf", kept.0, id_of(&kept.1)),
        format!("{}/{}.png", kept.0, id_of(&kept.2)),
        format!("{}.txt", id_of(&staged)),
    ];
    expected.sort();
    assert_eq!(temp.stored(), expected);
    assert_eq!(temp.folders(), vec![kept.0.clone()]);
    assert_eq!((temp.rows("sent=1"), temp.rows("sent=0")), (2, 1));
    // The other chat still shows and previews what it sent.
    assert_eq!(sent_context(&runtime, &kept.0).len(), 2);
    request(&runtime, "attachment.asset", json!({"id":id_of(&kept.2)})).unwrap();
    assert_eq!(
        code(request(
            &runtime,
            "attachment.asset",
            json!({"id":id_of(&chats[0].2)})
        )),
        "not_found"
    );
    // The files the reader chose are still where they were.
    for file in ["doomed.pdf", "doomed.png", "kept.pdf", "staged.txt"] {
        assert!(temp.0.join("downloads").join(file).exists());
    }
}

#[tokio::test]
async fn the_demo_provider_keeps_an_attachment_without_reading_it() {
    let temp = Temp::new();
    let runtime = open(&temp, Scripted::new("supported"));
    let attached = item(&runtime, &temp.chosen("notes.txt", b"hello"));
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    send(
        &runtime,
        "conv-layout",
        "Here",
        std::slice::from_ref(&attached),
        "demo",
    )
    .unwrap();
    assert_eq!(settled(&mut events.receiver).await, SessionStatus::Idle);
    let context = sent_context(&runtime, "conv-layout");
    assert_eq!(context.last().unwrap()["attachment"]["name"], "notes.txt");
    assert_eq!(temp.rows("sent=1 AND resource_id='conv-layout'"), 1);
    assert_eq!(
        temp.stored(),
        vec![format!("conv-layout/{}.txt", id_of(&attached))]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_text_attachment_previews_its_start_and_other_types_do_not() {
    let temp = Temp::new();
    let agent = Scripted::new("supported");
    let runtime = open(&temp, agent.clone());
    let preview = |id: &str| request(&runtime, "attachment.text", json!({"id": id}));

    // A short text file is shown whole, staged and after it is sent.
    let log = item(
        &runtime,
        &temp.chosen("build.log", "ok ✓\nwarning: unused\n".as_bytes()),
    );
    let shown = preview(id_of(&log)).unwrap();
    assert_eq!(
        shown,
        json!({"text":"ok ✓\nwarning: unused\n","truncated":false})
    );
    let resource = chat(&runtime, "preview-chat");
    let mut events = runtime.subscribe(SubscriptionScope::default()).unwrap();
    send(
        &runtime,
        &resource,
        "read it",
        std::slice::from_ref(&log),
        "preview-send",
    )
    .unwrap();
    settled(&mut events.receiver).await;
    assert_eq!(preview(id_of(&log)).unwrap(), shown);

    // A long one shows only its start, cut on a whole character.
    let long = "é".repeat(40_000);
    let big = item(&runtime, &temp.chosen("long.txt", long.as_bytes()));
    let start = preview(id_of(&big)).unwrap();
    assert_eq!(start["truncated"], json!(true));
    let text = start["text"].as_str().unwrap();
    assert!(text.len() <= 64 * 1024 && text.len() > 60 * 1024);
    assert!(long.starts_with(text));

    // Anything that is not text has no text preview, whatever it is called.
    for (name, bytes) in [
        ("report.pdf", PDF),
        ("shot.png", PNG),
        ("notes.txt", b"a\0b".as_slice()),
    ] {
        let binary = item(&runtime, &temp.chosen(name, bytes));
        assert_eq!(code(preview(id_of(&binary))), "invalid_request", "{name}");
    }
    assert_eq!(
        code(preview("attachment-00000000-0000-4000-8000-000000000000")),
        "not_found"
    );
}
