Dim shell, fso, serverPath, pythonPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
serverPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Change to the server directory
shell.CurrentDirectory = serverPath

' Start Python server hidden, then open browser after short delay
shell.Run "cmd /c python asr_api_server.py > NUL 2>&1", 0, False

' Wait 3 seconds for server to start
WScript.Sleep 3000

' Open browser to the app
shell.Run "cmd /c start http://localhost:8000", 0, False

Set shell = Nothing
Set fso = Nothing
