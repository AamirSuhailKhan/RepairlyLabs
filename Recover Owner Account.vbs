Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fs.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
result = shell.Run("node scripts\browser-access.mjs recover", 0, True)
If Err.Number <> 0 Or result <> 0 Then MsgBox "Unable to open owner recovery. Make sure Node.js 22+ is installed, and check browser-access.log in this folder. If an old server is running, close it first.", 48, "RepairlyLabs"
