; ============================================================================
; NEXOR ERP — NSIS installer hooks (Phase 7) — v1.0.34
; ----------------------------------------------------------------------------
; Registers / removes Windows Firewall inbound rules so the auto-spawned
; Express backend (ports 3000-3009, see electron/backendManager.cjs) can
; accept LAN connections from networked clients without prompting the user
; the first time a client tries to reach the server-mode PC.
;
; Why a port range?
;   backendManager.cjs probes 3000..3009 for a free port at startup, so we
;   must whitelist the whole range — not just 3000.
;
; Rule naming convention: "NEXOR-ERP-Backend-<port>"  (one rule per port)
;   - Easy to enumerate for clean removal on uninstall.
;   - Easy for an IT admin to spot in `wf.msc`.
;
; netsh exit codes are ignored (SetErrors / ClearErrors) so a missing rule
; on uninstall, or an Admin-rights edge case, never blocks the installer.
; ============================================================================

!macro customInstall
  DetailPrint "Configuring Windows Firewall for NEXOR ERP backend..."

  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}

  Push 3000
  Loop_AddRule:
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXOR-ERP-Backend-$0"'
    Pop $1

    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NEXOR-ERP-Backend-$0" dir=in action=allow protocol=TCP localport=$0 profile=private,domain,public description="NEXOR ERP Express backend (auto-spawned)"'
    Pop $1
    ${If} $1 == 0
      DetailPrint "  + Firewall rule added for TCP port $0"
    ${Else}
      DetailPrint "  ! Could not add firewall rule for port $0 (exit $1) — continuing"
    ${EndIf}

    IntOp $0 $0 + 1
    ${If} $0 <= 3009
      Push $0
      Goto Loop_AddRule
    ${EndIf}

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXOR-ERP-WS-4546"'
  Pop $1
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NEXOR-ERP-Discovery-41234" dir=in action=allow protocol=UDP localport=41234 profile=private,domain,public description="NEXOR ERP UDP LAN discovery"'
  Pop $1
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NEXOR-ERP-WS-4546" dir=in action=allow protocol=UDP localport=4546 profile=private,domain,public description="NEXOR ERP LAN discovery / realtime sync"'
  Pop $1
  ${If} $1 == 0
    DetailPrint "  + Firewall rule added for UDP port 4546 (LAN discovery)"
  ${EndIf}

  ; Copy schema repair helpers to C:\NEXOR ERP (server database.env lives here)
  CreateDirectory "C:\NEXOR ERP"
  IfFileExists "$INSTDIR\resources\fix-server-schema.cmd" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\fix-server-schema.cmd" "C:\NEXOR ERP\fix-server-schema.cmd"
  IfFileExists "$INSTDIR\resources\fix-server-schema.ps1" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\fix-server-schema.ps1" "C:\NEXOR ERP\fix-server-schema.ps1"
  IfFileExists "$INSTDIR\resources\repair-server-schema-now.ps1" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\repair-server-schema-now.ps1" "C:\NEXOR ERP\repair-server-schema-now.ps1"

  ClearErrors
!macroend

!macro customUnInstall
  DetailPrint "Removing NEXOR ERP firewall rules..."

  Push 3000
  Loop_DelRule:
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXOR-ERP-Backend-$0"'
    Pop $1
    IntOp $0 $0 + 1
    ${If} $0 <= 3009
      Push $0
      Goto Loop_DelRule
    ${EndIf}

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXOR-ERP-Discovery-41234"'
  Pop $1
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NEXOR-ERP-WS-4546"'
  Pop $1

  DetailPrint "Firewall rules removed."
  ClearErrors
!macroend
