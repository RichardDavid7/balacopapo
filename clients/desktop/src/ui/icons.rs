//! Ícones vetoriais SVG extraídos 1:1 dos componentes oficiais do Backspace / Balacopapo Web.
//! Renderizados nativamente em GPU via `iced::widget::svg` (zero quadrados `█`).

#![allow(dead_code)]

use iced::widget::svg;
use iced::{Color, Length};

fn icon<'a>(bytes: &'static [u8], size: f32, color: Color) -> svg::Svg<'a> {
    svg::Svg::new(svg::Handle::from_memory(bytes))
        .width(Length::Fixed(size))
        .height(Length::Fixed(size))
        .style(move |_theme, _status| svg::Style { color: Some(color) })
}

const SVG_BACKSPACE_MARK: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="28.5 28 200 200" fill="currentColor"><path d="M151.191 38C175.386 38 195 57.5367 195 81.6364C195 103.651 177.153 121.498 155.138 121.498H121.104C119.429 121.498 118.269 120.983 117.625 119.953C116.981 118.795 117.432 117.443 118.978 115.899L149.516 85.5845C151.32 83.7826 151.32 81.9809 149.516 80.179L144.684 75.3519C142.88 73.5498 141.076 73.5498 139.272 75.3519L89.0206 125.553C87.2168 127.355 87.2168 129.222 89.0206 131.152L139.659 181.739C141.463 183.541 143.267 183.541 145.071 181.739L149.516 177.106C151.32 175.304 151.32 173.501 149.516 171.699L118.978 141.192C117.432 139.648 116.981 138.36 117.625 137.33C118.269 136.172 119.429 135.593 121.104 135.593H156.229C177.642 135.593 195 152.951 195 174.364C195 198.463 175.386 218 151.191 218H105.809C81.614 218 62 198.463 62 174.364V81.6364C62 57.5367 81.614 38 105.809 38L151.191 38Z"/></svg>"#;
const SVG_HASH: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41001 9L8.35001 15H14.35L15.41 9H9.41001Z"/></svg>"#;
const SVG_VOLUME: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2V15H6L11 19V5ZM15.54 8.46C16.48 9.4 17 10.67 17 12S16.48 14.6 15.54 15.54L14.12 14.12C14.69 13.55 15 12.79 15 12S14.69 10.45 14.12 9.88L15.54 8.46ZM19.07 4.93C20.95 6.81 22 9.35 22 12S20.95 17.19 19.07 19.07L17.66 17.66C19.16 16.16 20 14.12 20 12S19.16 7.84 17.66 6.34L19.07 4.93Z"/></svg>"#;
const SVG_MIC: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>"#;
const SVG_MIC_OFF: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>"#;
const SVG_HEADPHONES: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h2v-7H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-2v7h2c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>"#;
const SVG_HEADPHONES_OFF: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h2v-7H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-2v7h2c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>"#;
const SVG_SETTINGS: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23-.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>"#;
const SVG_MESSAGE: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>"#;
const SVG_MONITOR: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 18C21.1 18 22 17.1 22 16V6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V16C2 17.1 2.9 18 4 18H0V20H24V18H20ZM4 6H20V16H4V6Z"/><path d="M15 11L11 14V12H9V10H11V8L15 11Z"/></svg>"#;
const SVG_MUSIC: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>"#;
const SVG_AI_MIC: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-1.66 0-3 1.34-3 3v2c0 1.66 1.34 3 3 3s3-1.34 3-3v-2c0-1.66-1.34-3-3-3z"/><path d="M17 11v1c0 2.76-2.24 5-5 5s-5-2.24-5-5v-1H5v1c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92v-1h-2z"/><circle cx="18" cy="5" r="1.4"/><circle cx="6" cy="5" r="1.4"/></svg>"#;
const SVG_NETWORK: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="10.5" y1="7.5" x2="6.5" y2="16.5"/><line x1="13.5" y1="7.5" x2="17.5" y2="16.5"/><line x1="8" y1="19" x2="16" y2="19"/></svg>"#;
const SVG_LAYERS: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>"#;
const SVG_REFRESH: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>"#;
const SVG_LOGOUT: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>"#;
const SVG_PHONE_OFF: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9C10.4 9 8.85 9.25 7.4 9.72V12.82C7.4 13.22 7.17 13.56 6.84 13.72C5.86 14.21 4.97 14.84 4.18 15.57C4 15.75 3.75 15.85 3.48 15.85C3.2 15.85 2.95 15.74 2.77 15.56L0.29 13.08C0.11 12.9 0 12.65 0 12.38C0 12.1 0.11 11.85 0.29 11.67C3.34 8.78 7.46 7 12 7S20.66 8.78 23.71 11.67C23.89 11.85 24 12.1 24 12.38C24 12.65 23.89 12.9 23.71 13.08L21.23 15.56C21.05 15.74 20.8 15.85 20.52 15.85C20.25 15.85 20 15.75 19.82 15.57C19.03 14.84 18.14 14.21 17.16 13.72C16.83 13.56 16.6 13.22 16.6 12.82V9.72C15.15 9.25 13.6 9 12 9Z"/></svg>"#;
const SVG_USERS: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.794 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006ZM20 20.006H22V19.006C22 16.451 20.178 14.471 17.532 13.471C19.461 14.601 20 16.561 20 19.006V20.006Z"/></svg>"#;
const SVG_SIGNAL: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>"#;
const SVG_NOISE_SUPPRESSION: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="10" x2="4" y2="14"/><line x1="8" y1="7" x2="8" y2="17"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="16" y1="7" x2="16" y2="17"/><line x1="20" y1="10" x2="20" y2="14"/></svg>"#;
const SVG_VIDEO: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z"/></svg>"#;
const SVG_VIDEO_OFF: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>"#;
const SVG_MEGAPHONE: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 13v-2Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>"#;
const SVG_ADD_CIRCLE: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>"#;
const SVG_JOIN_ARROW: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>"#;
const SVG_EXPLORE_COMPASS: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z"/></svg>"#;
const SVG_INVITE_USER: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>"#;
const SVG_CHEVRON_DOWN: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>"#;
const SVG_CHEVRON_RIGHT: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>"#;
const SVG_CHEVRON_UP: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>"#;
const SVG_BELL: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>"#;
const SVG_SEARCH: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21.707 20.293l-5.395-5.395A7.457 7.457 0 0018 10.5 7.5 7.5 0 1010.5 18c1.575 0 3.027-.486 4.228-1.31l5.476 5.476a.997.997 0 001.414 0l.089-.089a1 1 0 000-1.414l.001-.37zM10.5 16a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/></svg>"#;
const SVG_DOWNLOAD_TRAY: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>"#;
const SVG_STICKER: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h9l7-7V5c0-1.1-.9-2-2-2zm-5 16v-5h5l-5 5z"/></svg>"#;
const SVG_SMILE: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>"#;
const SVG_LOCK: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>"#;
const SVG_CLOSE: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"/></svg>"#;

pub fn backspace_mark<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_BACKSPACE_MARK, size, color)
}
pub fn hash<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_HASH, size, color)
}
pub fn volume<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_VOLUME, size, color)
}
pub fn mic<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MIC, size, color)
}
pub fn mic_off<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MIC_OFF, size, color)
}
pub fn headphones<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_HEADPHONES, size, color)
}
pub fn headphones_off<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_HEADPHONES_OFF, size, color)
}
pub fn settings<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_SETTINGS, size, color)
}
pub fn message<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MESSAGE, size, color)
}
pub fn monitor<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MONITOR, size, color)
}
pub fn music<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MUSIC, size, color)
}
pub fn ai_mic<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_AI_MIC, size, color)
}
pub fn network<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_NETWORK, size, color)
}
pub fn layers<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_LAYERS, size, color)
}
pub fn refresh<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_REFRESH, size, color)
}
pub fn logout<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_LOGOUT, size, color)
}
pub fn phone_off<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_PHONE_OFF, size, color)
}
pub fn users<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_USERS, size, color)
}
pub fn signal<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_SIGNAL, size, color)
}
pub fn noise_suppression<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_NOISE_SUPPRESSION, size, color)
}
pub fn video<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_VIDEO, size, color)
}
pub fn video_off<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_VIDEO_OFF, size, color)
}
pub fn megaphone<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_MEGAPHONE, size, color)
}
pub fn add_circle<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_ADD_CIRCLE, size, color)
}
pub fn join_arrow<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_JOIN_ARROW, size, color)
}
pub fn explore_compass<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_EXPLORE_COMPASS, size, color)
}
pub fn invite_user<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_INVITE_USER, size, color)
}
pub fn chevron_down<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_CHEVRON_DOWN, size, color)
}
pub fn chevron_right<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_CHEVRON_RIGHT, size, color)
}
pub fn chevron_up<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_CHEVRON_UP, size, color)
}
pub fn bell<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_BELL, size, color)
}
pub fn search<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_SEARCH, size, color)
}
pub fn download_tray<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_DOWNLOAD_TRAY, size, color)
}
pub fn sticker<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_STICKER, size, color)
}
pub fn smile<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_SMILE, size, color)
}
pub fn lock<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_LOCK, size, color)
}
pub fn close<'a>(size: f32, color: Color) -> svg::Svg<'a> {
    icon(SVG_CLOSE, size, color)
}
