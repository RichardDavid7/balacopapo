; Instalador oficial do Balacopapo Desktop (Windows x64) — Inno Setup 6
; Instala por usuário em %LOCALAPPDATA%\Balacopapo (sem UAC e compatível com auto-update silencioso).

#define MyAppName "Balacopapo"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "Balacopapo"
#define MyAppURL "https://github.com/RichardDavid7/balacopapo"
#define MyAppExeName "Balacopapo.exe"

[Setup]
AppId={{8D6B4A3C-5E1B-4C7A-9F2A-7B1E4C9A2026}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\dist
OutputBaseFilename=Balacopapo-Setup-windows-x64
SetupIconFile=..\..\icons\snafuonda.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "Iniciar o Balacopapo automaticamente com o Windows"; GroupDescription: "Sistema:"; Flags: unchecked

[Files]
Source: "..\..\target\release\balacopapo-desktop.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "..\..\icons\snafuonda.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\snafuonda.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\snafuonda.ico"; Tasks: desktopicon

[Registry]
; Protocolo de link profundo balacopapo://
Root: HKCU; Subkey: "Software\Classes\balacopapo"; ValueType: string; ValueName: ""; ValueData: "URL:Balacopapo Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\balacopapo"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\balacopapo\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"",0"
Root: HKCU; Subkey: "Software\Classes\balacopapo\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""
; Auto-start opcional
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Balacopapo"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
