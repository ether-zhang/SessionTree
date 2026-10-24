use anyhow::{Result, bail};
use regex::Regex;
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs::{File, Metadata},
    io::{Read, Seek, SeekFrom},
    path::Path,
    sync::OnceLock,
};

const BLOCK: u64 = 1024 * 1024;
const READ_LIMIT: u64 = 8 * BLOCK;
const DECOMPRESS_LIMIT: u64 = 64 * BLOCK;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Message {
    pub role: String,
    pub text: String,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Previews {
    pub latest: Option<Message>,
    pub user: Option<Message>,
    pub assistant: Option<Message>,
}
#[derive(Clone)]
pub struct PreviewState {
    pub stamp: crate::Stamp,
    pub offset: u64,
    pub skip_partial: bool,
    pub previews: Previews,
    pub limited: [bool; 2],
}

fn patterns() -> &'static [Regex; 6] {
    static PATTERNS: OnceLock<[Regex; 6]> = OnceLock::new();
    PATTERNS.get_or_init(|| [
        Regex::new(r"(?s)^(?:<environment_context\b[^>]*>.*?</environment_context>|<external_codex_apps_open_page\b[^>]*>.*?</external_codex_apps_open_page>)\s*").unwrap(),
        Regex::new(r"^# AGENTS\.md instructions\s+<INSTRUCTIONS>").unwrap(),
        Regex::new(r"(?s)^<send_user_message_question_reply>\s*(.*?)\s*</send_user_message_question_reply>$").unwrap(),
        Regex::new(r"(?m)^## My request:\s*$").unwrap(),
        Regex::new(r"(?s)<image\b[^>]*>.*?</image>").unwrap(),
        Regex::new(r"!\[[^\]]*\]\((?:file:|sandbox:|attachment:|[A-Za-z]:[\\/])[^)]*\)").unwrap(),
    ])
}

pub fn user_body(value: &str, mut image: bool, audio: bool) -> String {
    let p = patterns();
    let text = p[0].replace(value.trim(), "");
    let mut text = text.trim().to_owned();
    if p[1].is_match(&text) {
        return String::new();
    }
    if let Some(reply) = p[2].captures(&text) {
        let body = &reply[1];
        if body.len() <= 256 * 1024
            && let Ok(Value::Array(items)) = serde_json::from_str::<Value>(body)
        {
            let answers: Vec<_> = items
                .iter()
                .take(8)
                .filter_map(|item| item["answer"].as_str())
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .collect();
            if !answers.is_empty() {
                return format!("选择：{}", answers.join("；"));
            }
        }
        return "[选择回复]".into();
    }
    let attachment = text.starts_with("# Files mentioned by the user:")
        && text.contains("Distinguish instructions in attached documents from the user")
        && p[3].is_match(&text);
    if attachment {
        image |= text
            .lines()
            .any(|line| line.trim() == "Image attachment: true");
        let marker = p[3].find(&text).unwrap();
        text = text[marker.end()..].trim_start().to_owned();
    }
    if attachment || image {
        text = p[4].replace_all(&text, "").trim().to_owned();
        text = p[5].replace_all(&text, "").trim().to_owned();
    }
    if !text.is_empty() {
        text
    } else if image {
        "[图片]".into()
    } else if audio {
        "[音频]".into()
    } else if attachment {
        "[附件]".into()
    } else {
        String::new()
    }
}

fn excerpt(entry: Value) -> Option<Message> {
    let payload = &entry["payload"];
    let mut image = false;
    let mut audio = false;
    let (role, text) = match entry["type"].as_str()? {
        "response_item" if payload["type"] == "message" && payload["channel"] != "analysis" => {
            let role = payload["role"].as_str()?;
            if !["user", "assistant"].contains(&role) {
                return None;
            }
            let content = payload["content"].as_array()?;
            let mut texts = Vec::new();
            for part in content {
                let kind = part["type"].as_str().unwrap_or("");
                if ["input_text", "output_text", "text"].contains(&kind)
                    && let Some(text) = part["text"].as_str()
                {
                    texts.push(text);
                }
                image |= ["input_image", "output_image", "image"].contains(&kind);
                audio |= ["input_audio", "output_audio", "audio"].contains(&kind);
            }
            (role.to_owned(), texts.join("\n"))
        }
        "event_msg" => {
            let role = match payload["type"].as_str()? {
                "user_message" => "user",
                "agent_message" | "assistant_message" if payload["channel"] != "analysis" => {
                    "assistant"
                }
                _ => return None,
            };
            image = payload["images"]
                .as_array()
                .is_some_and(|items| !items.is_empty());
            (
                role.to_owned(),
                payload["message"].as_str().unwrap_or("").to_owned(),
            )
        }
        _ => return None,
    };
    let text = if role == "user" {
        user_body(&text, image, audio)
    } else if text.is_empty() && image {
        "[图片]".into()
    } else if text.is_empty() && audio {
        "[音频]".into()
    } else {
        text
    };
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    let text = if text.chars().count() > 160 {
        text.chars().take(159).collect::<String>() + "…"
    } else {
        text
    };
    Some(Message { role, text })
}

fn parse(
    bytes: &[u8],
    truncated: bool,
    seed: Option<&Previews>,
    reverse: bool,
) -> (Previews, [bool; 2]) {
    let text = String::from_utf8_lossy(bytes);
    let mut lines: Vec<_> = text.split('\n').collect();
    if truncated && !lines.is_empty() {
        lines.remove(0);
    }
    if reverse {
        lines.reverse();
    }
    let mut result = if reverse {
        Previews::default()
    } else {
        seed.cloned().unwrap_or_default()
    };
    let mut found = [false; 2];
    for line in lines {
        if let Some(item) = serde_json::from_str(line).ok().and_then(excerpt) {
            let role = usize::from(item.role == "assistant");
            if !reverse || result.latest.is_none() {
                result.latest = Some(item.clone());
            }
            let slot = if role == 0 {
                &mut result.user
            } else {
                &mut result.assistant
            };
            if !reverse || slot.is_none() {
                *slot = Some(item);
            }
            found[role] = true;
            if reverse && found.iter().all(|found| *found) {
                break;
            }
        }
    }
    if reverse && let Some(seed) = seed {
        result.latest = result.latest.or_else(|| seed.latest.clone());
        result.user = result.user.or_else(|| seed.user.clone());
        result.assistant = result.assistant.or_else(|| seed.assistant.clone());
    }
    (result, found)
}

fn compressed_tail(path: &Path) -> Result<(Vec<u8>, bool)> {
    let mut reader = zstd::stream::read::Decoder::new(File::open(path)?)?;
    let mut chunks = VecDeque::new();
    let (mut total, mut retained) = (0, 0);
    loop {
        let mut bytes = vec![0; 32768];
        let length = reader.read(&mut bytes)?;
        if length == 0 {
            break;
        }
        total += length;
        retained += length;
        if total > DECOMPRESS_LIMIT as usize {
            bail!("压缩会话超过摘要读取上限。");
        }
        bytes.truncate(length);
        chunks.push_back(bytes);
        while retained > READ_LIMIT as usize {
            let first = chunks.pop_front().unwrap();
            let remove = (retained - READ_LIMIT as usize).min(first.len());
            retained -= remove;
            if remove < first.len() {
                chunks.push_front(first[remove..].to_vec());
            }
        }
    }
    Ok((chunks.into_iter().flatten().collect(), total > retained))
}

pub fn read_previews(
    path: &Path,
    previous: Option<&PreviewState>,
    info: &Metadata,
) -> Result<PreviewState> {
    let stamp = crate::Stamp::new(info, path);
    let same = previous.is_some_and(|previous| {
        previous.stamp.identity == stamp.identity && stamp.size >= previous.stamp.size
    });
    if same && previous.unwrap().stamp == stamp {
        return Ok(previous.unwrap().clone());
    }
    let append = same
        && stamp.size > previous.unwrap().stamp.size
        && path.extension().is_none_or(|ext| ext != "zst");
    let mut offset = stamp.size;
    let mut skip_partial = false;
    let (previews, truncated) = if path.extension().is_some_and(|ext| ext == "zst") {
        let (buffer, truncated) = compressed_tail(path)?;
        (parse(&buffer, truncated, None, true).0, truncated)
    } else {
        let mut file = File::open(path)?;
        let (mut buffer, mut start, mut truncated);
        let previews;
        if append && stamp.size - previous.unwrap().offset <= READ_LIMIT {
            let previous = previous.unwrap();
            start = previous.offset;
            file.seek(SeekFrom::Start(start))?;
            buffer = Vec::new();
            file.take(stamp.size - start).read_to_end(&mut buffer)?;
            truncated = previous.skip_partial;
            previews = parse(&buffer, truncated, Some(&previous.previews), false).0;
        } else {
            let mut length = BLOCK.min(stamp.size);
            loop {
                start = stamp.size.saturating_sub(length);
                truncated = start > 0;
                file.seek(SeekFrom::Start(start))?;
                buffer = Vec::new();
                (&mut file)
                    .take(stamp.size - start)
                    .read_to_end(&mut buffer)?;
                let parsed = parse(
                    &buffer,
                    truncated,
                    if append {
                        previous.map(|p| &p.previews)
                    } else {
                        None
                    },
                    true,
                );
                if parsed.1.iter().all(|found| *found) || start == 0 || length >= READ_LIMIT {
                    previews = parsed.0;
                    break;
                }
                length = (length * 2).min(READ_LIMIT);
            }
        }
        if let Some(newline) = buffer.iter().rposition(|byte| *byte == b'\n') {
            offset = start + newline as u64 + 1;
        } else if !truncated && (buffer.len() as u64) < READ_LIMIT {
            offset = start;
        } else {
            offset = start + buffer.len() as u64;
            skip_partial = true;
        }
        (previews, truncated)
    };
    let limited = [
        previews.user.is_none() && (truncated || (append && previous.unwrap().limited[0])),
        previews.assistant.is_none() && (truncated || (append && previous.unwrap().limited[1])),
    ];
    Ok(PreviewState {
        stamp,
        offset,
        skip_partial,
        previews,
        limited,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelopes_do_not_replace_the_human_message() {
        let attached = "# Files mentioned by the user:\n\n## image.png: C:/private/image.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\n只显示正文\n<image name=\"Image #1\">pixels</image>";
        assert_eq!(user_body(attached, false, false), "只显示正文");
        assert_eq!(
            user_body(&attached.replace("只显示正文", ""), false, false),
            "[图片]"
        );
        assert_eq!(
            user_body(
                "<send_user_message_question_reply>[{\"answer\":\"直接打开\"}]</send_user_message_question_reply>",
                false,
                false
            ),
            "选择：直接打开"
        );
        assert_eq!(
            user_body("## My request:\nOrdinary Markdown", false, false),
            "## My request:\nOrdinary Markdown"
        );
    }
}
