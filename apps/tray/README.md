# HAO Bridge Tray

Windows system-tray controller for the user-owned HAO Bridge. It runs as the
signed-in user, stores the Bridge administrator token in Windows Credential
Manager, launches Java directly, and contains the Bridge plus extension
runtimes in a kill-on-close Windows Job Object.

Build and publish:

```powershell
dotnet publish apps/tray/Hao.Bridge.Tray.csproj -c Release -r win-x64 --self-contained false -o apps/tray/publish
```

The app locates the repository by walking upward from its executable until it
finds `pnpm-workspace.yaml`. It therefore expects to run from within the HAO
repository checkout.
