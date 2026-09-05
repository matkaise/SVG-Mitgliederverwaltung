$ErrorActionPreference = 'Stop'

function Write-Section([string]$Title) {
  Write-Host ''
  Write-Host ('=== {0} ===' -f $Title)
}

function Write-QueryResult(
  [System.Data.SqlClient.SqlConnection]$Connection,
  [string]$Query
) {
  $command = $Connection.CreateCommand()
  $command.CommandText = $Query
  $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
  $table = [System.Data.DataTable]::new()
  [void]$adapter.Fill($table)

  if ($table.Rows.Count -eq 0) {
    Write-Host '(keine Eintraege)'
    return
  }

  $formattedTable = $table | Format-Table -AutoSize | Out-String -Width 240
  Write-Host $formattedTable
}

Write-Host 'GUT SPG Datenbank-Diagnose (rein lesend)'

Write-Section 'Windows-Benutzer'
Write-Host ([Security.Principal.WindowsIdentity]::GetCurrent().Name)

Write-Section 'SPG-Konfiguration'
$dbIniPath = 'C:\ProgramData\SPG-Daten\db.ini'
if (Test-Path -LiteralPath $dbIniPath) {
  Write-Host ('Gefunden: {0}' -f $dbIniPath)
  $databaseLine = Get-Content -LiteralPath $dbIniPath -Encoding Default |
    Where-Object { $_ -match '^SQLDatenbank=' } |
    Select-Object -First 1
  if ($databaseLine) {
    Write-Host $databaseLine
  }
  else {
    Write-Host 'Keine Zeile SQLDatenbank= gefunden.'
  }
}
else {
  Write-Host ('Nicht gefunden: {0}' -f $dbIniPath)
}

Write-Section 'SPG-Datenbankdateien'
$databaseFiles = @(
  'C:\ProgramData\SPG-Daten\mandanten\GUT\spg_verein_GUT.mdf',
  'C:\ProgramData\SPG-Daten\mandanten\GUT\spg_verein_GUT_log.ldf'
)
foreach ($databaseFile in $databaseFiles) {
  if (Test-Path -LiteralPath $databaseFile) {
    $fileDetails = Get-Item -LiteralPath $databaseFile |
      Select-Object FullName, Length, LastWriteTime |
      Format-List |
      Out-String
    Write-Host $fileDetails
  }
  else {
    Write-Host ('Nicht gefunden: {0}' -f $databaseFile)
  }
}

Write-Section 'LocalDB-Instanzen'
$localDbCommand = Get-Command 'SqlLocalDB.exe' -ErrorAction SilentlyContinue
if ($localDbCommand) {
  $localDbExecutable = $localDbCommand.Source
  & $localDbExecutable info
  Write-Host ''
  & $localDbExecutable info MSSQLLocalDB
}
else {
  Write-Host 'SqlLocalDB.exe wurde im PATH nicht gefunden.'
}

Write-Section 'Datenbanken in (LocalDb)\MSSQLLocalDB'
$masterConnectionString = 'Server=(LocalDb)\MSSQLLocalDB;Database=master;Integrated Security=True;Application Name=GUT-SPG-Diagnose;Connect Timeout=10;'
$masterConnection = [System.Data.SqlClient.SqlConnection]::new($masterConnectionString)
try {
  $masterConnection.Open()
  Write-QueryResult $masterConnection @'
SELECT
  name AS DatabaseName,
  state_desc AS State,
  user_access_desc AS UserAccess,
  recovery_model_desc AS RecoveryModel
FROM sys.databases
WHERE database_id > 4
ORDER BY name;
'@

  Write-Section 'Zugeordnete Datenbankdateien'
  Write-QueryResult $masterConnection @'
SELECT
  DB_NAME(database_id) AS DatabaseName,
  type_desc AS FileType,
  state_desc AS State,
  physical_name AS PhysicalPath
FROM sys.master_files
WHERE database_id > 4
ORDER BY DatabaseName, FileType;
'@
}
catch {
  Write-Host ('Verbindung zu master fehlgeschlagen: {0}' -f $_.Exception.Message)
}
finally {
  $masterConnection.Dispose()
}

Write-Section 'Direkter Test von spg_verein_GUT'
$targetConnectionString = 'Server=(LocalDb)\MSSQLLocalDB;Database=spg_verein_GUT;Integrated Security=True;Application Name=GUT-SPG-Diagnose;Connect Timeout=10;'
$targetConnection = [System.Data.SqlClient.SqlConnection]::new($targetConnectionString)
try {
  $targetConnection.Open()
  Write-Host 'Erfolgreich: spg_verein_GUT ist fuer diesen Windows-Benutzer erreichbar.'
}
catch {
  Write-Host ('Fehlgeschlagen: {0}' -f $_.Exception.Message)
}
finally {
  $targetConnection.Dispose()
}

Write-Host ''
Write-Host 'Diagnose beendet. Es wurden keine Daten veraendert.'
