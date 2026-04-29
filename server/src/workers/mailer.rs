//! メール送信 abstraction (Sprint 2 / N1-N2)
//!
//! **責務**:
//!   - `Mailer` trait で送信抽象を切り、実装を差し替え可能にする
//!   - `StubMailer` は dev / test 既定: 送信内容を tracing log + 内部 Vec に貯めるだけ
//!   - production では `lettre::AsyncSmtpTransport` ラッパ実装を別途作る (= PR N-3 以降)
//!
//! **設計判断**:
//!   - lettre の `Message` builder で MIME を組み立てる (= 自前 RFC 5322 実装は避ける)
//!   - `Mailer` は `Send + Sync + 'static` (= worker から spawn 越しに使える)
//!   - 失敗は `MailerError` で詰めて返す。retry は呼び出し側 (= email_send relay loop) の責務

use std::sync::{Arc, Mutex};

use lettre::message::Message;

#[derive(Debug, thiserror::Error)]
pub enum MailerError {
    #[error("invalid message: {0}")]
    Invalid(String),
    #[error("send failed: {0}")]
    Send(String),
}

/// 1 通分の送信内容。lettre `Message` を内部で構築するため、ここでは plain な
/// 入力 (= from / to / subject / text body) のみ持つ。HTML body 等は将来追加。
#[derive(Debug, Clone)]
pub struct OutgoingMail {
    pub to: String,
    pub from: String,
    pub subject: String,
    pub text_body: String,
}

impl OutgoingMail {
    /// lettre `Message` に変換 (= MIME header 等を組み立てる)。
    /// アドレス形式不正は `MailerError::Invalid` を返す。
    pub fn to_lettre(&self) -> Result<Message, MailerError> {
        Message::builder()
            .from(
                self.from
                    .parse()
                    .map_err(|e| MailerError::Invalid(format!("from {}: {e}", self.from)))?,
            )
            .to(self
                .to
                .parse()
                .map_err(|e| MailerError::Invalid(format!("to {}: {e}", self.to)))?)
            .subject(&self.subject)
            .body(self.text_body.clone())
            .map_err(|e| MailerError::Invalid(format!("body: {e}")))
    }
}

/// メール送信抽象。worker (= email_send relay loop) から呼ばれる。
#[async_trait::async_trait]
pub trait Mailer: Send + Sync {
    async fn send(&self, mail: OutgoingMail) -> Result<(), MailerError>;
}

/// dev / test 既定の Mailer。送信は実行せず、tracing::info ログ + 内部 Vec に貯めるだけ。
/// `sent_messages()` で test 側から検査できる。
#[derive(Debug, Default, Clone)]
pub struct StubMailer {
    inbox: Arc<Mutex<Vec<OutgoingMail>>>,
}

impl StubMailer {
    pub fn new() -> Self {
        Self::default()
    }

    /// 送信履歴を順序保持で取得する (= test 用)。
    pub fn sent_messages(&self) -> Vec<OutgoingMail> {
        self.inbox.lock().expect("stub inbox poisoned").clone()
    }

    /// 送信履歴をクリア (= test 用)。
    pub fn clear(&self) {
        self.inbox.lock().expect("stub inbox poisoned").clear();
    }
}

#[async_trait::async_trait]
impl Mailer for StubMailer {
    async fn send(&self, mail: OutgoingMail) -> Result<(), MailerError> {
        // lettre Message 化を試行して MIME バリデーションも済ませる (= test で MIME 壊れを検出)。
        let _msg = mail.to_lettre()?;
        tracing::info!(
            to = %mail.to,
            from = %mail.from,
            subject = %mail.subject,
            "stub mailer: would send mail"
        );
        self.inbox.lock().expect("stub inbox poisoned").push(mail);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(to: &str) -> OutgoingMail {
        OutgoingMail {
            to: to.to_string(),
            from: "noreply@kochu.example".to_string(),
            subject: "test subject".to_string(),
            text_body: "test body".to_string(),
        }
    }

    #[tokio::test]
    async fn stub_mailer_records_sent_message() {
        let m = StubMailer::new();
        m.send(fixture("alice@example.com")).await.unwrap();
        m.send(fixture("bob@example.com")).await.unwrap();
        let sent = m.sent_messages();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].to, "alice@example.com");
        assert_eq!(sent[1].to, "bob@example.com");
    }

    #[tokio::test]
    async fn stub_mailer_rejects_invalid_address() {
        let m = StubMailer::new();
        let bad = OutgoingMail {
            to: "not-an-email".to_string(),
            ..fixture("dummy@example.com")
        };
        let res = m.send(bad).await;
        assert!(matches!(res, Err(MailerError::Invalid(_))));
        // 失敗時は inbox に積まれない
        assert!(m.sent_messages().is_empty());
    }

    #[tokio::test]
    async fn stub_mailer_clear_resets_inbox() {
        let m = StubMailer::new();
        m.send(fixture("a@example.com")).await.unwrap();
        m.clear();
        assert!(m.sent_messages().is_empty());
    }
}
