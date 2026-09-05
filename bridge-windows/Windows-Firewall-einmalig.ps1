$ErrorActionPreference = 'Stop'

$ruleName = 'GUT SPG-Bruecke via WinBoat'
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    throw 'Dieses Skript muss einmalig als Administrator ausgefuehrt werden.'
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'Die Firewall-Regel ist bereits vorhanden.'
    exit 0
}

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 8787 `
    -RemoteAddress 172.18.0.0/16 `
    -Profile Any | Out-Null

Write-Host 'Firewall-Regel fuer das lokale WinBoat-Docker-Netz angelegt.'
