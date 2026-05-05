Dim shell, fso, dir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
' 通过 Electron 启动桌面端，窗口完全隐藏
shell.Run "cmd /c npx electron electron/main.js", 0, False
Set shell = Nothing
