```powershell
Get-ChildItem -Path .\build -Recurse | Select-Object -Property Name, @{Name="Size";Expression={"{0:N2} {1}" -f ($_.Length / 1MB), "MB"}}, @{Name="Checksum";Expression={(Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash}}
```

<pre style="font-size:64%;color:white;background:black">
Name       Size    Checksum
----       ----    --------
index.html 0,32 MB 3EA9034370A7C31FC29BF66AF99D2636D806B9C2C14040C97A01658973B095F5
</pre>