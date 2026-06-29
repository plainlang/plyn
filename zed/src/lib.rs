//! Zed extension for the ***plain spec-driven language (published as "plyn").
//!
//! The language features (hover / go-to-definition / rename) live in the
//! `plain-language-server` npm package. This shim makes sure that package is
//! installed — using Zed's own bundled Node — and hands Zed the command to
//! run it, so installing the extension is all an end user has to do.
//!
//! Server resolution order:
//!   1. An explicit `lsp.plain-language-server.binary` { path, arguments } in
//!      the user's Zed settings (escape hatch for custom or local builds).
//!   2. A `plain-language-server` already on PATH (e.g. `npm link` while
//!      developing the server locally).
//!   3. Otherwise: install the `plain-language-server` npm package with Zed's
//!      bundled Node and run `node <pkg>/out/cli.js --stdio`.

use std::env;
use std::fs;

use zed_extension_api::{
    self as zed,
    settings::LspSettings,
    Command, LanguageServerId, Result, Worktree,
};

/// npm package that provides the language server.
const PACKAGE_NAME: &str = "plain-language-server";

/// Entry script inside the installed package, relative to the extension's
/// working directory (which is also the process CWD when the server launches).
const SERVER_PATH: &str = "node_modules/plain-language-server/out/cli.js";

struct PlynExtension {
    /// Set once we've confirmed an installed, up-to-date server this session,
    /// so we don't hit the npm registry on every `language_server_command`.
    did_find_server: bool,
}

impl PlynExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_PATH).map_or(false, |stat| stat.is_file())
    }

    /// Ensure `plain-language-server` is installed (and up to date), returning
    /// the path to its entry script relative to the extension work dir.
    fn server_script_path(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        let installed = self.server_exists();
        if self.did_find_server && installed {
            return Ok(SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let latest = zed::npm_package_latest_version(PACKAGE_NAME)?;

        if !installed
            || zed::npm_package_installed_version(PACKAGE_NAME)?.as_deref() != Some(latest.as_str())
        {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            match zed::npm_install_package(PACKAGE_NAME, &latest) {
                Ok(()) => {
                    if !self.server_exists() {
                        return Err(format!(
                            "installed `{PACKAGE_NAME}` but `{SERVER_PATH}` is missing"
                        ));
                    }
                }
                // If a previous install is still present (e.g. we're offline),
                // keep using it rather than failing the launch.
                Err(error) => {
                    if !self.server_exists() {
                        return Err(error);
                    }
                }
            }
        }

        self.did_find_server = true;
        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for PlynExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Command> {
        // 1. Explicit override in settings.json.
        if let Ok(settings) = LspSettings::for_worktree(language_server_id.as_ref(), worktree) {
            if let Some(binary) = settings.binary {
                if let Some(path) = binary.path {
                    return Ok(Command {
                        command: path,
                        args: binary.arguments.unwrap_or_else(default_server_args),
                        env: Default::default(),
                    });
                }
            }
        }

        // 2. A `plain-language-server` already on PATH (dev flow: `npm link`).
        if let Some(path) = worktree.which(PACKAGE_NAME) {
            return Ok(Command {
                command: path,
                args: default_server_args(),
                env: Default::default(),
            });
        }

        // 3. Install from npm (using Zed's bundled Node) and run the script.
        let server_path = self.server_script_path(language_server_id)?;
        let server_abs = env::current_dir()
            .map_err(|e| format!("could not resolve working directory: {e}"))?
            .join(&server_path)
            .to_string_lossy()
            .into_owned();

        let mut args = vec![server_abs];
        args.extend(default_server_args());

        Ok(Command {
            command: zed::node_binary_path()?,
            args,
            env: Default::default(),
        })
    }
}

fn default_server_args() -> Vec<String> {
    vec!["--stdio".to_string()]
}

zed::register_extension!(PlynExtension);
