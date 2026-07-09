$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$lanHost = $env:LAN_HOST
if (-not $lanHost) {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.AddressState -eq "Preferred" -and
      $_.InterfaceAlias -notmatch "vEthernet|Virtual|WSL|Loopback|Bluetooth|VMware|Hyper-V"
    }

  $candidate = $addresses |
    Where-Object { $_.PrefixOrigin -eq "Dhcp" } |
    Select-Object -First 1

  if (-not $candidate) {
    $candidate = $addresses | Select-Object -First 1
  }

  $lanHost = $candidate.IPAddress
}

if (-not $lanHost) {
  $lanHost = "localhost"
}

$certDir = Join-Path $repoRoot "certificates"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$keyPath = Join-Path $certDir "lan-dev-key.pem"
$certPath = Join-Path $certDir "lan-dev-cert.pem"
$configPath = Join-Path $certDir "lan-dev-openssl.cnf"

$subjectAltNames = @(
  "DNS:localhost",
  "IP:127.0.0.1"
)

$parsedIp = $null
if ([System.Net.IPAddress]::TryParse($lanHost, [ref]$parsedIp)) {
  $subjectAltNames += "IP:$lanHost"
} else {
  $subjectAltNames += "DNS:$lanHost"
}

$config = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = BRAVE AI Local Dev
O = BRAVE AI CCTV

[v3_req]
subjectAltName = $($subjectAltNames -join ', ')
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
"@

[System.IO.File]::WriteAllText($configPath, $config)

Write-Host "Generating HTTPS dev certificate for localhost and $lanHost..."
& openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes `
  -keyout $keyPath `
  -out $certPath `
  -config $configPath `
  -extensions v3_req | Out-Host

Write-Host ""
Write-Host "BRAVE AI HTTPS dev server"
Write-Host "Local:   https://localhost:3000"
Write-Host "Network: https://$($lanHost):3000"
Write-Host ""
Write-Host "If a phone browser blocks camera access, trust/install this dev certificate or use a trusted HTTPS tunnel."
Write-Host "Certificate: $certPath"
Write-Host ""

$env:LAN_HOST = $lanHost
& npx next dev --hostname 0.0.0.0 --experimental-https --experimental-https-key $keyPath --experimental-https-cert $certPath