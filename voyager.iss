; ================================================================
;  voyager.iss — Inno Setup Script for Voyager
;  User-level install (no UAC), silent update support
;  Install to: %LocalAppData%\Programs\Voyager
; ================================================================

#define AppName       "Voyager"
#define AppPublisher  "Voyager"
#define AppURL        "https://github.com/Swoodles/voyager-releases"
#define AppExeName    "Voyager.exe"
#define AppVersion    "1.2.0"
#define AppDesc       "Smart Vacation Planner"

[Setup]
; --- Identity ---
AppId                    = {{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}}
AppName                  = {#AppName}
AppVersion               = {#AppVersion}
AppVerName               = {#AppName} v{#AppVersion}
AppPublisher             = {#AppPublisher}
AppPublisherURL          = {#AppURL}
AppSupportURL            = {#AppURL}
AppUpdatesURL            = {#AppURL}
AppComments              = {#AppDesc}

; --- Install location (user-level, NO UAC prompt) ---
DefaultDirName           = {localappdata}\Programs\{#AppName}
PrivilegesRequired       = lowest
PrivilegesRequiredOverridesAllowed = commandline

; --- Output ---
OutputDir                = installer_output
OutputBaseFilename       = Voyager-Setup-{#AppVersion}
SetupIconFile            = assets\icon.ico
UninstallDisplayIcon     = {app}\{#AppExeName}
UninstallDisplayName     = {#AppName} — {#AppDesc}

; --- UI ---
WizardStyle              = modern
WizardSizePercent        = 110
DisableWelcomePage       = yes
DisableDirPage           = yes
DisableProgramGroupPage  = yes
DisableReadyPage         = yes

; --- Behavior ---
Compression              = lzma2/ultra64
SolidCompression         = yes
ShowLanguageDialog       = no
ArchitecturesInstallIn64BitMode = x64

; --- Versioning (enables silent upgrade over existing install) ---
VersionInfoVersion       = {#AppVersion}
VersionInfoCompany       = {#AppPublisher}
VersionInfoDescription   = {#AppName} Setup
VersionInfoProductName   = {#AppName}
VersionInfoProductVersion = {#AppVersion}


[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"


[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce


[Files]
; Main executable and all PyInstaller output
Source: "dist\Voyager\{#AppExeName}";   DestDir: "{app}"; Flags: ignoreversion
Source: "dist\Voyager\_internal\*";     DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs
; Version manifest (bundled so app can read it offline)
Source: "version.json";                 DestDir: "{app}"; Flags: ignoreversion


[Icons]
; Start Menu
Name: "{userprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; \
  IconFilename: "{app}\{#AppExeName}"; Comment: "{#AppDesc}"
; Desktop (optional)
Name: "{userdesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; \
  IconFilename: "{app}\{#AppExeName}"; Comment: "{#AppDesc}"; \
  Tasks: desktopicon


[Run]
; Launch after install (not during silent installs)
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; \
  Flags: nowait postinstall skipifsilent


[UninstallDelete]
; Clean up app-extracted files on uninstall
Type: filesandordirs; Name: "{localappdata}\Voyager\app"
Type: filesandordirs; Name: "{localappdata}\Voyager\updates"
; NOTE: We intentionally keep \profile (user data/localStorage)


[Code]
// ── Kill running instance before upgrading ──────────────────────
procedure CloseRunningInstance();
var
  ResultCode: Integer;
begin
  // Silently terminate any running Voyager.exe
  Exec('taskkill.exe', '/F /IM Voyager.exe', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  Sleep(800);  // Wait for process to die
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    CloseRunningInstance();
end;
