//! 🕸️ NETWORKING & MULTIPLAYER SUBSYSTEMS — Protocol, presence, and rally matchmaking.
//!
//! PORTS: `legacy/src/net/protocol.ts`, `legacy/src/net/presence.ts`, `legacy/src/net/rally.ts`

pub mod presence;
pub mod protocol;
pub mod rally;
pub mod socket;

pub use presence::*;
pub use protocol::*;
pub use rally::*;
pub use socket::*;
