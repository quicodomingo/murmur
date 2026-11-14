//! The system's secret store, for the cloud keys and the share connection: the macOS Keychain,
//! Windows' Credential Manager or the Secret Service on Linux (GNOME Keyring, KWallet). Never a
//! plain file.

use anyhow::{Result, anyhow};

/// The secret saved under `service` / `account`; `None` if there isn't one.
pub fn get(service: &str, account: &str) -> Option<Vec<u8>> {
    imp::get(service, account)
}

pub fn set(service: &str, account: &str, secret: &[u8]) -> Result<()> {
    imp::set(service, account, secret)
}

/// Removes the secret; nothing saved is not an error.
pub fn delete(service: &str, account: &str) -> Result<()> {
    imp::delete(service, account)
}

/// `out.len()` bytes from the system's secure random generator.
pub fn random_bytes(out: &mut [u8]) {
    getrandom::fill(out).expect("system random generator");
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use security_framework::passwords;

    /// errSecItemNotFound.
    const NOT_FOUND: i32 = -25300;

    pub fn get(service: &str, account: &str) -> Option<Vec<u8>> {
        passwords::get_generic_password(service, account).ok()
    }

    pub fn set(service: &str, account: &str, secret: &[u8]) -> Result<()> {
        passwords::set_generic_password(service, account, secret).map_err(|e| anyhow!("{e}"))
    }

    pub fn delete(service: &str, account: &str) -> Result<()> {
        match passwords::delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(anyhow!("{e}")),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use keyring::{Entry, Error};

    pub fn get(service: &str, account: &str) -> Option<Vec<u8>> {
        Entry::new(service, account).ok()?.get_secret().ok()
    }

    pub fn set(service: &str, account: &str, secret: &[u8]) -> Result<()> {
        Entry::new(service, account)
            .and_then(|e| e.set_secret(secret))
            .map_err(|e| anyhow!("{e}"))
    }

    pub fn delete(service: &str, account: &str) -> Result<()> {
        match Entry::new(service, account).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow!("{e}")),
        }
    }
}
