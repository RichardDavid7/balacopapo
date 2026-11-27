//! Scanner ultraleve de **Presença de Jogos** (Windows Win32 / Linux `/proc` via `sysinfo`).
//!
//! Zero-Stutter Budget:
//! - Nunca dispara subprocessos (`tasklist`/`ps`).
//! - Lê apenas nomes de processos (`ProcessRefreshKind::new()`) sob demanda ou a cada 10s.
//! - Respeita privacidade (toggle global, lista de ignorados e override manual).

#![allow(dead_code)]

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedGame {
    pub process_name: String,
    pub display_name: String,
}

const KNOWN_GAMES: &[(&str, &str)] = &[
    ("cs2", "Counter-Strike 2"),
    ("valorant-win64-shipping", "VALORANT"),
    ("league of legends", "League of Legends"),
    ("dota2", "Dota 2"),
    ("cyberpunk2077", "Cyberpunk 2077"),
    ("eldenring", "Elden Ring"),
    ("r5apex", "Apex Legends"),
    ("rocketleague", "Rocket League"),
    ("bg3", "Baldur's Gate 3"),
    ("bg3_dx11", "Baldur's Gate 3"),
    ("helldivers2", "Helldivers 2"),
    ("pathofexile", "Path of Exile"),
    ("pathofexile2", "Path of Exile 2"),
    ("javaw", "Minecraft (Java)"),
    ("minecraft.windows", "Minecraft"),
    ("overwatch", "Overwatch 2"),
    ("wow", "World of Warcraft"),
    ("ffxiv_dx11", "Final Fantasy XIV"),
    ("gtav", "Grand Theft Auto V"),
    ("deadlock", "Deadlock"),
];

pub fn match_known_game(raw_process_name: &str, ignored: &[String]) -> Option<DetectedGame> {
    let clean = raw_process_name
        .trim()
        .trim_end_matches(".exe")
        .to_ascii_lowercase();

    if ignored
        .iter()
        .any(|ig| ig.trim().eq_ignore_ascii_case(&clean) || ig.trim().eq_ignore_ascii_case(raw_process_name.trim()))
    {
        return None;
    }

    KNOWN_GAMES.iter().find_map(|(exe, title)| {
        if clean == *exe {
            Some(DetectedGame {
                process_name: raw_process_name.to_string(),
                display_name: (*title).to_string(),
            })
        } else {
            None
        }
    })
}

/// Faz uma varredura única e rápida dos processos ativos em busca de jogos conhecidos.
pub fn scan_running_game(ignored: &[String]) -> Option<DetectedGame> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());

    for proc_info in sys.processes().values() {
        let name = proc_info.name().to_string_lossy();
        if let Some(found) = match_known_game(&name, ignored) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_known_games_and_respects_ignore_list() {
        let found = match_known_game("cs2.exe", &[]).unwrap();
        assert_eq!(found.display_name, "Counter-Strike 2");

        let ignored = vec!["cs2".to_string()];
        assert!(match_known_game("cs2.exe", &ignored).is_none());
        assert!(match_known_game("notepad.exe", &[]).is_none());
    }
}
