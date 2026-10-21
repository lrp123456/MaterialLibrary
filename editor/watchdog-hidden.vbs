' 以隐藏窗口方式运行 watchdog.bat（计划任务用，避免每次登录弹黑框）
' 关闭方式：任务管理器结束 node.exe，或 schtasks /end /tn MaterialStudio-ClipEditor
Dim shell, fso, base
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = base
shell.Run """" & base & "\watchdog.bat""", 0, False
