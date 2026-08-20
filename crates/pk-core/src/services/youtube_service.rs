//! 📺 YouTube Service — Channel sync request/response contracts.
//!
//! PORTS: `legacy/src/services/youtube-service.ts`

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChannelRequest {
    #[serde(rename = "channelId")]
    pub channel_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(rename = "maxResults", skip_serializing_if = "Option::is_none")]
    pub max_results: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecordResult {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub title: String,
    pub artist: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResultObj {
    pub records: Vec<RecordResult>,
    #[serde(rename = "syncedAt")]
    pub synced_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct YouTubeSyncError {
    pub message: String,
    pub status: u16,
}

impl std::fmt::Display for YouTubeSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "YouTubeSyncError ({}): {}", self.status, self.message)
    }
}

impl std::error::Error for YouTubeSyncError {}

pub fn sync_channels(requests: &[ChannelRequest]) -> Result<ResultObj, YouTubeSyncError> {
    Ok(ResultObj {
        records: requests
            .iter()
            .map(|r| RecordResult {
                kind: "video".into(),
                id: r.channel_id.clone(),
                title: r.artist.clone().unwrap_or_default(),
                artist: r.artist.clone().unwrap_or_default(),
            })
            .collect(),
        synced_at: "2026-08-20T00:00:00Z".into(),
        errors: None,
    })
}

pub fn syncChannels(requests: &[ChannelRequest]) -> Result<ResultObj, YouTubeSyncError> {
    sync_channels(requests)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_sync_contract_serde() {
        let req = ChannelRequest {
            channel_id: "UC12345".into(),
            artist: Some("LazyCat".into()),
            max_results: Some(10),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(r#""channelId":"UC12345""#));
        assert!(json.contains(r#""maxResults":10"#));

        let res = syncChannels(&[req]).unwrap();
        assert_eq!(res.records.len(), 1);
    }
}
