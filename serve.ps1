$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5173
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

function Write-Response($stream, $status, $contentType, $body) {
  $reason = if ($status -eq 200) { "OK" } else { "Not Found" }
  $header = "HTTP/1.1 $status $reason`r`nContent-Length: $($body.Length)`r`nContent-Type: $contentType`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
}

try {
  $listener.Start()
  Write-Host "Serving $root at http://127.0.0.1:$port/"
  Write-Host "Press Ctrl+C to stop."

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      $parts = $requestLine.Split(" ")
      $requestPath = [Uri]::UnescapeDataString($parts[1].Split("?")[0].TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($requestPath)) {
        $requestPath = "index.html"
      }

      $candidate = Join-Path $root $requestPath
      $fullPath = [System.IO.Path]::GetFullPath($candidate)
      $rootPath = [System.IO.Path]::GetFullPath($root)

      if ($fullPath.StartsWith($rootPath) -and (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($fullPath)
        Write-Response $stream 200 (Get-ContentType $fullPath) $body
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Write-Response $stream 404 "text/plain; charset=utf-8" $body
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
