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
