$node = "C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
$worktree = "C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer-test"

$apiLog = "C:\Users\lrp\.dsh-material-library-test\logs\api.log"
$apiErrLog = "C:\Users\lrp\.dsh-material-library-test\logs\api-err.log"
$webLog = "C:\Users\lrp\.dsh-material-library-test\logs\web.log"
$webErrLog = "C:\Users\lrp\.dsh-material-library-test\logs\web-err.log"

$apiProc = Start-Process -FilePath $node -ArgumentList "scripts\start-test-runner.js" -WorkingDirectory $worktree -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog -PassThru -WindowStyle Hidden
$apiProc.Id | Out-File "C:\Users\lrp\.dsh-material-library-test\api.pid" -Encoding ascii

$webProc = Start-Process -FilePath $node -ArgumentList "scripts\start-web-runner.js" -WorkingDirectory $worktree -RedirectStandardOutput $webLog -RedirectStandardError $webErrLog -PassThru -WindowStyle Hidden
$webProc.Id | Out-File "C:\Users\lrp\.dsh-material-library-test\web.pid" -Encoding ascii

Write-Host "Started API pid $($apiProc.Id), Web pid $($webProc.Id)"
