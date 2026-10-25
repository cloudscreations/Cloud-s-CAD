# Notes on the Creative Crown hotwire controller (from the old "Machine Tools Suite", ExtraTech Corporation)

Found in the copied Machine Tools folder (files only read, never run):
- Suite: JobServer, JobPreviewer2, JobReporter, MotionMechanic (terminal for manual communication), MachineParameters, MachineUpdate.
- The PC reaches the controller over Ethernet (TCP/IP): controller at 192.168.50.2, "MC (7695)". ETCComX.log shows ping checks and
  "connect to port 99" to drop an old connection, plus "Broadcasting JMON/LOCK message" lines.
- JobServer watches a folder (ProjectFile.etc: UCPath = C:\CODE) and lists the jobs on the pendant DNC screen. Dropping a .tap there works.
- Machine settings live in Hotwire8700.dbi (Microsoft Access / Jet): table Machine (Keyword, StringValue, DoubleValue, LongValue, Location,
  Type, Description), family hw_m41 v3.8. init/MP.dbi is the factory default set. Cloud's CAD reads these with mdb-reader.
- init/*.mtr are servo tuning files (Kp, Ki, torque limits) for each axis. Do not edit these.
- NOT known yet: how settings are written to the controller. To find out we need either the MotionMechanic / MachineParameters help
  text (Windows .hlp) or a packet capture of MachineParameters sending a change (Wireshark on the old PC, filter ip.addr == 192.168.50.2).

## What the old help books say (decoded from the .hlp files)
- The controller speaks "uCito" (micro-Cito), a text, postfix command language. Machine parameters live in its NVRAM, each at a numbered location.
- MachineParameters writes a changed value with: `<value> <location> set_float`, `<value> <location> set_integer`, `"<text>" <location> set_string`,
  then reboots the controller (unless the field says REBOOT=NO). "Send as Email" / Print produce the same lines. Locations match the
  `Location` column in Hotwire8700.dbi (for example 300 = cut speed for material 1).
- MotionMechanic: terminal (serial COM port or the network connection), Send File (run), Store File (U = user init, P = machine parameters,
  F = firmware), Capture NVRAM, Reboot Controller, Go Native, E-Stop, Pause, Handshake Test.
- The network transport itself is inside ETCComX.ocx, which was not in the copied folder. To talk to the controller directly we need that
  file (and the "Networking Guide" from the old Start menu), or a packet capture of MotionMechanic's terminal.

## Found in ETCComX.ocx (read-only disassembly, 2026-10-23; nothing was run)
These come from reading the code of the old network control. They are leads, not proven facts. Test each one against the real controller before building on it.
- Transport is plain TCP/IP (Windows sockets), plus MFC socket classes. Main code strings: MainPort, ControlPort, RealTimePort, "SEND socket".
- Before connecting, it pings the controller, and if "another application is using the connection" it connects to **TCP port 99** and closes it to kill the old connection (confirmed in the code and the log).
- Port numbers pushed as constants before MFC Connect calls: **23** (MainPort), **29** (ControlPort), **6201** (SEND socket, 0x1839), 6202 (0x183a, a Create call). Which carries commands and which carries files is not yet known.
- Message names in the code: CONQ (connection query, sent as "CONQ    <name>"), ACKREQ / ACKR (acknowledge request/reply). "Secure mode" blocks binary data.
- JMON / LOCK / UNLK broadcasts ("XXXXJMON", "XXXXLOCK", "XXXXUNLK" + a character) are UDP broadcasts between PCs running JobServer, to coordinate who is using the machine. They are not needed to talk to the controller.
- Connection definitions live in the Windows registry under Software\ExtraTech\ConnMgr (not in the zip).
- Missing from the zip: Xlate.dll (file translator), and the registry export for ConnMgr.

## From the old PC registry (HKCU\Software\ExtraTech, exported 2026-10-23)
- Saved connection: MachineID "MC (7695)", Type TCP/IP, AttachedTo 192.168.50.2, DBI = Hotwire8700.dbi. No port number is stored there, so the ports are fixed inside ETCComX (23 / 29 / 6201 / 6202 / 99 were seen in the code; unverified).
- Old PC network card: static 192.168.50.1 / 255.255.255.0, no gateway (dedicated link, 10 Mbps).
- JobServer: DNC folder C:\CODE\ ; also a Digitize folder, a HotWatch InBox/OutBox pair (4 s refresh) under Program Files\Machine Tools, and a job history database (JobHistory.mdb, jobque.mdb).
- File types: CNC text extensions "cnc txt tap" (G-code style, converted by Xlate.dll, with an M-code table in ProjectFile.etc), uCito extensions "uc nc ucj", binary "uc".
- MotionMechanic: SecureCommunications = 0, SmartDownloads = 0.
- Likely consequence (inference, not proven): the controller expects its own uCito language, and the old JobServer converts our G-code (.tap) to it before sending. A JobServer replacement may therefore need that conversion (Xlate.dll holds it), unless the controller accepts the .tap files directly from the folder.

## From xlate.dll (the file translator, 2026-10-23, strings only, nothing run)
The old JobServer's translator (xlate.dll) converts job files (CNC/G-code text, HPGL) into the controller's uCito language. Command templates and words found in it (meaning NOT yet verified against a controller):
- Moves/arcs: "<x> <y> SP", "<x> <y> <z> SP", "<x> <y> AC", "... arc3", "... ahelic", "start_spline / end_spline / start_spline3 / start_spline4", "ucito_2d", "ucito_3d", "slew_mode", "restrt_here".
- Speeds and settings: "<n> F", "<n> FM", "<n> speed", "<n> power", "set_up_feedrate", "set_down_feedrate", "set_spindle_speed", "set_res", "set_pen_depth", "set_pen_lift".
- Flow: "<n> delay", "<n> tool_change", "<n> prg_pause", "<n> set_fixture", "<n> set_port", HPGL "<n> PU / <n> PD".
- Exported entry points: XlateStart, XlateStep, XlateEnd, XlateBreakLine/XYZ/Cmd/Set/Sheet, XlateGetFileType, XlateGetSetInfo, XlateOverrideFixture.
- It reads the ProjectFile.etc settings (DefaultCutSpeed, DefaultSlewSpeed, Accel, MCodeNN tables) to build the output.
- Machine description files: ethernet.uci ("Ethernet Based Machine Tool", ConnInfo1="TCP/IP") and default.uci (serial, 57600 baud, even parity).
Next step when the laptop link works: ask the controller for its version (read-only) and confirm one tiny move translation by hand before sending any real job.

## Connection test (desktop app)
Machine tab → "Test the connection to the machine". It only looks: one ping, then checks whether TCP ports 23, 29, 6201, 6202 (and 99 if ticked) accept a connection, then hangs up. It sends no commands. Private addresses only (10.x, 172.16-31.x, 192.168.x).
Laptop setup: Ethernet fixed IP 192.168.50.1, mask 255.255.255.0, no gateway, old PC off the cable (or use 192.168.50.10 if the old PC stays connected). Controller is 192.168.50.2. Close JobServer first: the controller takes one connection at a time. Tick port 99 last.

## Confirmed on the old PC (23 Oct 2026)
- `netstat -n` with JobServer online: two TCP connections from the PC to the controller, 192.168.50.1:1049 -> 192.168.50.2:23 and 192.168.50.1:1050 -> 192.168.50.2:29. So the PC opens the connection, and it uses ports 23 and 29 (not 6201/6202/99).
- JobServer log (jobserver_MC (7695)_Log.txt): "Connection established: MC (7695)", project file C:\Program Files\Machine Tools\ProjectFile.etc, "Sleep Mode Active" releases the link, "Attempting to go Online" reconnects in about a second. It does not log file transfers.
- JobServer tray menu: DNC, HotWatch, JobQueue, Digitize, JobHistory, JobMonitor, Session Log, Program Settings, Go Offline, Exit. DNC window: "Display files from this folder: C:\CODE\", with a Pendant View.
- Net shares on the old PC: IPC$, C (C:\), My Documents. No CODE share, so the pedestal most likely gets its file list through JobServer's connection, not a Windows share.
- The connection test now also listens for ~2 s after connecting and shows anything the controller says by itself. It never sends a byte.

## Protocol clues from ETCComX.ocx disassembly (23 Oct 2026)
- Two TCP sockets, ports hard-coded in the OCX: 23 (MainPort) and 29 (ControlPort). Matches netstat on the old PC.
- Door 23 sometimes announces itself with text starting `>>Connecting to Ethernet Host<<` (seen once from the new PC; the first run was silent). The command language on this port is Forth-like text (the controller's uCito), lines ended with CR.
- Command strings the OCX builds: `%d store`, `"" %s" %d set_string`, `%d %d set_integer`, `%f %d set_float`, `ifexists store_binary %d %d store_binary` (binary files), `%d restart_sheet`, `%d restart_tool`, `1 %f %f %f restart_xyz`, plus `ifmissing restart_sheet : restart_sheet drop ;` style definitions.
- UDP broadcasts XXXXLOCK / XXXXUNLK / XXXXJMON are PC-to-PC only. Port 99 is used to kill an old connection.
- File extensions in the registry: G-code `cnc txt tap`, uCito text `uc nc ucj`, binary `uc`.
- Not yet known: exact upload sequence for a program, the response format, whether a bare CR returns a prompt. Plan: read-only first (send a lone CR, read reply), then a tiny hand-written program shown to the operator before sending, E-stop in reach.
- Running the old JobServer on Windows 10 needs more DLLs from the old install (BmpPict2.dll, CNCToDXF.dll, ClassGL3.dll, maybe more); abandoned for now in favour of talking to the machine directly from Cloud's CAD.

## Listen recorder (23 Oct 2026)
Machine tab -> Test the connection -> "Listen while you use the pedestal". Connects to the chosen doors (default 23, 29), writes down everything the machine sends with timestamps (hex + text) and saves CloudsCAD-machine-log-<time>.txt in Documents. Sends nothing. Plan: press Listen, open the CODE folder on the pedestal and load one small program, press Stop, send the log. That shows what the pedestal asks its host for.
JobServer.exe imports (from the PE header): BmpPict2.dll, CNCToDXF.dll, ETCPE.dll, HPGLTranslator.dll; ClassGL3.dll is a dependency of one of those. These are not in the Machine Tools folder copy, so JobServer cannot start on a new PC without them. The maker publishes no installer. JobServer builds the pedestal file list with formats like "%-*s|%-245s" under FILES ... END_SHEETS, and uses msg / msg_info / getkey / host_terminate commands.

## Result on the shop PC (23 Oct 2026, from the desktop-app session)
- JobServer now runs on the shop PC (CROWN-DESKTOP) and feeds the controller. The pedestal's JOB SERVER key lists Desktop\CODE (C:\Users\User\Desktop\CODE). A test program cut correctly.
- Fix needed: the three missing DLLs (bmppict2.dll, classgl3.dll, cnctodxf.dll) from the old PC copied into Desktop\Machine Tools; ProjectFile.etc job folder pointed at the new CODE folder; etccomx.ocx and etcdbix.ocx registered; saved connection loaded from a .reg.
- Listen log from the controller (nothing sent to it): `>>Connecting to Ethernet Host<<` on connect; then about every 24 s `AD`, `05 06 53 30 06 AC`, and ~10 s later `0A 0D` (looks like a heartbeat, unconfirmed). Pressing JOB SERVER on the pedestal with no host shows "Connecting to host..." so the host must speak first. Exact handshake still unknown.
- Network: built-in Ethernet stays 192.168.50.1/24 with no gateway; internet via a separate USB Ethernet adapter. JobServer must be running for the pedestal to see files.
- Direct Cloud's CAD sender is deferred; it would need the handshake and G-code translation worked out, each message shown to the operator first.
