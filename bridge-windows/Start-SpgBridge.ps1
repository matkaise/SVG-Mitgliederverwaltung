param(
  [Parameter(Mandatory = $false)]
  [string]$ConfigPath = "$PSScriptRoot\config.json"
)

$ErrorActionPreference = "Stop"
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($config.Token) -or $config.Token.Length -lt 24) {
  throw "Das Bridge-Token muss mindestens 24 Zeichen lang sein."
}
if ($config.Mandant -notmatch '^[A-Z0-9_-]{1,10}$') {
  throw "Ungueltiges Mandantenkuerzel."
}
if ($config.Database -notmatch '^[A-Za-z0-9_]{1,80}$') {
  throw "Ungueltiger Datenbankname."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$connectionString = "Server=$($config.SqlInstance);Database=$($config.Database);Integrated Security=True;Application Name=GUT-SPG-Bridge;"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($config.ListenPrefix)
$listener.Start()
Write-Host "GUT SPG Bridge lauscht auf $($config.ListenPrefix)"

function Open-SqlConnection {
  $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
  $connection.Open()
  return $connection
}

function Get-Compatibility {
  $connection = Open-SqlConnection
  try {
    $command = $connection.CreateCommand()
    $command.CommandText = @"
SET QUOTED_IDENTIFIER ON;
SELECT
  CONVERT(int, SERVERPROPERTY('ProductMajorVersion')) AS SqlServerMajor,
  CONVERT(int, DATABASEPROPERTYEX(DB_NAME(), 'Version')) AS DatabaseVersion,
  CASE WHEN OBJECT_ID('dbo.tbl_Mitglied', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasMemberTable,
  CASE WHEN OBJECT_ID('dbo.SP_MitgliedNeu', 'P') IS NOT NULL
    AND OBJECT_ID('dbo.SP_MitgliedAktualisieren', 'P') IS NOT NULL
    AND OBJECT_ID('dbo.SP_MitgliedAbteilungBeitragAnfuegen', 'P') IS NOT NULL
    AND OBJECT_ID('dbo.SP_MitgliedAbteilungBeitragAktualisieren', 'P') IS NOT NULL
    THEN 1 ELSE 0 END AS HasWriteProcedures
"@
    $reader = $command.ExecuteReader()
    [void]$reader.Read()
    $compatible = ([int]$reader['SqlServerMajor'] -eq 12 -and [int]$reader['DatabaseVersion'] -eq 782 -and [int]$reader['HasMemberTable'] -eq 1)
    return @{
      connected = $true
      compatible = $compatible
      writeCompatible = ($compatible -and [int]$reader['HasWriteProcedures'] -eq 1 -and [bool]$config.EnableWrites)
      sqlServerMajor = [int]$reader['SqlServerMajor']
      databaseVersion = [int]$reader['DatabaseVersion']
      mandant = [string]$config.Mandant
      database = [string]$config.Database
    }
  }
  finally { $connection.Dispose() }
}

function Read-RequestJson([System.Net.HttpListenerRequest]$request) {
  $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
  try { return $reader.ReadToEnd() | ConvertFrom-Json }
  finally { $reader.Dispose() }
}

function Get-ExistingMemberRow($connection, $transaction, [string]$memberId) {
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandText = 'SELECT TOP 1 * FROM dbo.tbl_Mitglied WHERE MitgliedID = @id AND Geloescht = 0'
  [void]$command.Parameters.Add('@id', [System.Data.SqlDbType]::NVarChar, 10)
  $command.Parameters['@id'].Value = $memberId
  $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
  $table = [System.Data.DataTable]::new()
  [void]$adapter.Fill($table)
  if ($table.Rows.Count -eq 0) { return $null }
  return $table.Rows[0]
}

function Get-NextMemberId($connection, $transaction) {
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandText = 'SELECT dbo.fkt_NeueMitgliedID()'
  return ([long]$command.ExecuteScalar()).ToString('D10')
}

function Set-ProcedureValue($command, [string]$name, $value) {
  if (-not $command.Parameters.Contains($name)) { return }
  $command.Parameters[$name].Value = if ($null -eq $value -or $value -eq '') { [DBNull]::Value } else { $value }
}

function Get-ColumnForParameter([string]$parameterName) {
  $special = @{
    '@strWEB_Passwort' = 'Web_Passwort'
    '@intPostHausnummer' = 'Post_Hausnummer'
    '@strStrasseSortiert' = 'Strasse_Sortiert'
    '@strPostStrasseSortiert' = 'Post_Strasse_Sortiert'
  }
  if ($special.ContainsKey($parameterName)) { return $special[$parameterName] }
  if ($parameterName -match '^@(str|dat|bit|dec|int)(.+)$') { return $Matches[2] }
  return $parameterName.TrimStart('@')
}

function Invoke-MemberProcedure($connection, $transaction, [string]$procedureName, [string]$memberId, $member, $existingRow) {
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandType = [System.Data.CommandType]::StoredProcedure
  $command.CommandText = $procedureName
  [System.Data.SqlClient.SqlCommandBuilder]::DeriveParameters($command)
  foreach ($parameter in $command.Parameters) {
    if ($parameter.Direction -eq [System.Data.ParameterDirection]::ReturnValue) { continue }
    $column = Get-ColumnForParameter $parameter.ParameterName
    if ($null -ne $existingRow -and $existingRow.Table.Columns.Contains($column)) {
      $parameter.Value = $existingRow[$column]
    }
    elseif ($parameter.SqlDbType -eq [System.Data.SqlDbType]::Bit) { $parameter.Value = $false }
    elseif ($parameter.SqlDbType -in @([System.Data.SqlDbType]::Int, [System.Data.SqlDbType]::BigInt, [System.Data.SqlDbType]::Decimal, [System.Data.SqlDbType]::Money)) { $parameter.Value = 0 }
    else { $parameter.Value = [DBNull]::Value }
  }
  Set-ProcedureValue $command '@strMitgliedID' $memberId
  $mapping = @{
    '@strAnrede' = 'salutation'; '@strTitel' = 'title'; '@strVorname' = 'firstName'; '@strNachname' = 'lastName'
    '@strStrasse' = 'street'; '@strPLZ' = 'postalCode'; '@strOrt' = 'city'; '@strLand' = 'country'
    '@datGeburtsdatum' = 'birthDate'; '@strGeschlecht' = 'gender'; '@strTelefon_Privat' = 'phonePrivate'
    '@strTelefon_Dienstlich' = 'phoneBusiness'; '@strHandy_1' = 'phoneMobile'; '@strEmail' = 'email'
    '@strHomepage' = 'website'; '@datEintritt_Datum' = 'entryDate'; '@datAustritt_Datum' = 'exitDate'
    '@strKuendigung_Grund' = 'exitReason'; '@strZahlart' = 'paymentMethod'
    '@strZahler' = 'accountHolder'; '@strIBAN_Nr' = 'iban'; '@strBIC_Nr' = 'bic'
    '@strSepa_Mandats_Ref' = 'mandateReference'; '@datSepa_Datum_Mandats_Ref' = 'mandateSignedAt'
    '@strNotiz' = 'notes'; '@strBemerkungen' = 'notes'
  }
  foreach ($entry in $mapping.GetEnumerator()) {
    Set-ProcedureValue $command $entry.Key $member.($entry.Value)
  }
  Set-ProcedureValue $command '@strSepa_kz_ausfuehrung' $(if ($member.sepaSequence -eq 'FRST') { 'e' } else { 'f' })
  Set-ProcedureValue $command '@strTriggerModus' 'WEBAPP'
  if ($member.customFields) {
    $fields = $member.customFields
    if ($fields -is [string]) { $fields = $fields | ConvertFrom-Json }
    foreach ($index in 1..10) {
      $fieldName = 'Benutzerfeld_{0:D2}' -f $index
      Set-ProcedureValue $command ('@str' + $fieldName) $fields.$fieldName
    }
  }
  [void]$command.ExecuteNonQuery()
}

function Sync-SpgMembers($payload) {
  if (-not [bool]$config.EnableWrites) { throw 'Die SPG-Schreibfreigabe ist in config.json nicht aktiviert.' }
  $compatibility = Get-Compatibility
  if (-not $compatibility.writeCompatible) { throw 'Die strenge SPG-Schreibpruefung ist nicht bestanden.' }
  $connection = Open-SqlConnection
  $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
  $mappings = @()
  try {
    foreach ($member in @($payload.members)) {
      if ([string]::IsNullOrWhiteSpace([string]$member.firstName) -or [string]::IsNullOrWhiteSpace([string]$member.lastName) -or [string]::IsNullOrWhiteSpace([string]$member.entryDate)) {
        throw 'Vorname, Nachname und Eintrittsdatum sind fuer SPG erforderlich.'
      }
      $requestedId = [string]$member.memberNumber
      $existingRow = if ($requestedId -match '^\d{10}$') { Get-ExistingMemberRow $connection $transaction $requestedId } else { $null }
      $memberId = if ($null -ne $existingRow) { $requestedId } else { Get-NextMemberId $connection $transaction }
      if ($null -eq $existingRow -and (-not [string]::IsNullOrWhiteSpace([string]$member.functionName) -or -not [string]::IsNullOrWhiteSpace([string]$member.honors) -or -not [string]::IsNullOrWhiteSpace([string]$member.alternateAddress))) {
        throw "Funktionen, Ehrungen und abweichende Postanschrift muessen vor der Schreibfreigabe strukturiert zugeordnet werden ($requestedId)."
      }
      $procedure = if ($null -eq $existingRow) { 'dbo.SP_MitgliedNeu' } else { 'dbo.SP_MitgliedAktualisieren' }
      Invoke-MemberProcedure $connection $transaction $procedure $memberId $member $existingRow

      $contribution = $connection.CreateCommand()
      $contribution.Transaction = $transaction
      $contribution.CommandText = @"
SELECT
  (SELECT TOP 1 mab.MitglAbteilungID
   FROM dbo.tbl_Mitglied_Abteilung_Beitrag mab
   WHERE mab.MitgliedID = @memberId AND mab.Geloescht = 0
   ORDER BY mab.MitglAbteilungID) AS MitglAbteilungID,
  (SELECT TOP 1 ab.BeitragID
   FROM dbo.tbl_Abteilung_Beitrag ab
   JOIN dbo.tbl_Abteilung a ON a.AbteilungID = ab.AbteilungID
   WHERE ab.Geloescht = 0 AND ab.Beitragsart = @contributionType
     AND a.AbteilungBezeichnung = @department
   ORDER BY ab.BeitragID) AS BeitragID
"@
      [void]$contribution.Parameters.Add('@memberId', [System.Data.SqlDbType]::NVarChar, 10)
      [void]$contribution.Parameters.Add('@contributionType', [System.Data.SqlDbType]::NVarChar, 35)
      [void]$contribution.Parameters.Add('@department', [System.Data.SqlDbType]::NVarChar, 35)
      $contribution.Parameters['@memberId'].Value = $memberId
      $contribution.Parameters['@contributionType'].Value = [string]$member.contributionType
      $contribution.Parameters['@department'].Value = [string]$member.department
      $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($contribution)
      $table = [System.Data.DataTable]::new()
      [void]$adapter.Fill($table)
      $row = $table.Rows[0]
      if ($row['BeitragID'] -eq [DBNull]::Value) { throw "SPG-Beitragsart oder Abteilung nicht gefunden: $($member.contributionType) / $($member.department)" }
      $contributionProcedure = $connection.CreateCommand()
      $contributionProcedure.Transaction = $transaction
      $contributionProcedure.CommandType = [System.Data.CommandType]::StoredProcedure
      if ($row['MitglAbteilungID'] -eq [DBNull]::Value) {
        $contributionProcedure.CommandText = 'dbo.SP_MitgliedAbteilungBeitragAnfuegen'
      } else {
        $contributionProcedure.CommandText = 'dbo.SP_MitgliedAbteilungBeitragAktualisieren'
      }
      [System.Data.SqlClient.SqlCommandBuilder]::DeriveParameters($contributionProcedure)
      Set-ProcedureValue $contributionProcedure '@strMitgliedID' $memberId
      Set-ProcedureValue $contributionProcedure '@intMitglAbteilungID' $(if ($row['MitglAbteilungID'] -eq [DBNull]::Value) { $null } else { $row['MitglAbteilungID'] })
      Set-ProcedureValue $contributionProcedure '@intBeitragID' $row['BeitragID']
      Set-ProcedureValue $contributionProcedure '@strStatusID' 'a'
      Set-ProcedureValue $contributionProcedure '@datEintrittDatum' $(if ($member.departmentEntryDate) { $member.departmentEntryDate } else { $member.entryDate })
      Set-ProcedureValue $contributionProcedure '@strZahlweiseID' $(if ($member.paymentFrequency) { $member.paymentFrequency } else { 'j' })
      Set-ProcedureValue $contributionProcedure '@strSonderzahlweise' $null
      [void]$contributionProcedure.ExecuteNonQuery()

      $privacy = $connection.CreateCommand()
      $privacy.Transaction = $transaction
      $privacy.CommandText = 'UPDATE dbo.tbl_Mitglied SET DSGVOZugestimmt=@agreed, DSGVOZugestimmtAm=@agreedAt WHERE MitgliedID=@id'
      [void]$privacy.Parameters.Add('@agreed', [System.Data.SqlDbType]::Bit)
      [void]$privacy.Parameters.Add('@agreedAt', [System.Data.SqlDbType]::DateTime2)
      [void]$privacy.Parameters.Add('@id', [System.Data.SqlDbType]::NVarChar, 10)
      $privacy.Parameters['@agreed'].Value = -not [string]::IsNullOrWhiteSpace([string]$member.privacyConsentAt)
      $privacy.Parameters['@agreedAt'].Value = if ($member.privacyConsentAt) { [string]$member.privacyConsentAt } else { [DBNull]::Value }
      $privacy.Parameters['@id'].Value = $memberId
      [void]$privacy.ExecuteNonQuery()
      $mappings += @{ localMemberNumber = $requestedId; memberNumber = $memberId }
    }
    $transaction.Commit()
    return @{ ok = $true; mappings = $mappings }
  }
  catch { $transaction.Rollback(); throw }
  finally { $connection.Dispose() }
}

function Get-SpgMembers {
  $connection = Open-SqlConnection
  try {
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 120
    $command.CommandText = @"
SET QUOTED_IDENTIFIER ON;
SELECT
  RTRIM(m.MitgliedID) AS memberNumber,
  m.Anrede AS salutation,
  m.Titel AS title,
  m.Vorname AS firstName,
  m.Nachname AS lastName,
  m.Geschlecht AS gender,
  CONVERT(varchar(10), m.Geburtsdatum, 23) AS birthDate,
  m.Strasse AS street,
  m.PLZ AS postalCode,
  m.Ort AS city,
  RTRIM(m.Land) AS country,
  m.Telefon_Privat AS phonePrivate,
  m.Handy_1 AS phoneMobile,
  m.Telefon_Dienstlich AS phoneBusiness,
  m.Email AS email,
  m.Homepage AS website,
  CONVERT(varchar(10), m.Eintritt_Datum, 23) AS entryDate,
  CONVERT(varchar(10), m.Austritt_Datum, 23) AS exitDate,
  m.Kuendigung_Grund AS exitReason,
  RTRIM(ab.AbteilungID) AS departmentCode,
  a.AbteilungBezeichnung AS department,
  CONVERT(varchar(10), mab.Datum_Eintritt, 23) AS departmentEntryDate,
  ab.Beitragsart AS contributionType,
  CONVERT(int, ROUND(CASE mab.ZahlweiseID
    WHEN 'm' THEN ab.monatlich * 12
    WHEN 'v' THEN ab.vierteljahr * 4
    WHEN 'h' THEN ab.halbjahr * 2
    ELSE ab.jahr END * 100, 0)) AS annualFeeCents,
  mab.ZahlweiseID AS paymentFrequency,
  m.Zahlart AS paymentMethod,
  m.Zahler AS accountHolder,
  m.IBAN_Nr AS iban,
  m.BIC_Nr AS bic,
  m.Sepa_Mandats_Ref AS mandateReference,
  CONVERT(varchar(10), m.Sepa_Datum_Mandats_Ref, 23) AS mandateSignedAt,
  CASE m.Sepa_kz_ausfuehrung WHEN 'e' THEN 'FRST' ELSE 'RCUR' END AS sepaSequence,
  STUFF((SELECT '; ' + RTRIM(f.FunkBezeichnung)
    FROM dbo.tbl_Mitglied_Funktion mf
    JOIN dbo.tbl_Funktion f ON f.FunkID = mf.FunktionID
    WHERE mf.MitgliedID = m.MitgliedID AND mf.Geloescht = 0
    FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS functionName,
  STUFF((SELECT '; ' + RTRIM(e.EhrungBezeichnung) +
      CASE WHEN me.EhrungDatum IS NULL THEN '' ELSE ' (' + CONVERT(varchar(10), me.EhrungDatum, 104) + ')' END
    FROM dbo.tbl_Mitglied_Ehrung me
    JOIN dbo.tbl_Ehrung e ON e.EhrungID = me.EhrungID
    WHERE me.MitgliedID = m.MitgliedID AND me.Geloescht = 0
    FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '') AS honors,
  LTRIM(RTRIM(CONCAT(m.Post_Anrede, CHAR(10), m.Post_Titel, ' ', m.Post_Vorname, ' ', m.Post_Nachname,
    CHAR(10), m.Post_Zusatzadresse, CHAR(10), m.Post_Strasse, CHAR(10), m.Post_PLZ, ' ', m.Post_Ort,
    CHAR(10), RTRIM(m.Post_Land)))) AS alternateAddress,
  m.Benutzerfeld_01, m.Benutzerfeld_02, m.Benutzerfeld_03, m.Benutzerfeld_04, m.Benutzerfeld_05,
  m.Benutzerfeld_06, m.Benutzerfeld_07, m.Benutzerfeld_08, m.Benutzerfeld_09, m.Benutzerfeld_10,
  COALESCE(m.Bemerkungen, m.Notiz) AS notes,
  CONVERT(varchar(10), m.DSGVOZugestimmtAm, 23) AS privacyConsentAt,
  CONVERT(bit, COALESCE(m.DSGVOZugestimmt, 0)) AS privacyConsent
FROM dbo.tbl_Mitglied m
OUTER APPLY (
  SELECT TOP 1 x.* FROM dbo.tbl_Mitglied_Abteilung_Beitrag x
  WHERE x.MitgliedID = m.MitgliedID AND x.Geloescht = 0
  ORDER BY x.MitglAbteilungID
) mab
LEFT JOIN dbo.tbl_Abteilung_Beitrag ab ON ab.BeitragID = mab.BeitragID
LEFT JOIN dbo.tbl_Abteilung a ON a.AbteilungID = ab.AbteilungID
WHERE m.Geloescht = 0
ORDER BY m.Nachname, m.Vorname
"@
    $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
    $table = [System.Data.DataTable]::new()
    [void]$adapter.Fill($table)
    $members = @()
    foreach ($row in $table.Rows) {
      $customFields = [ordered]@{}
      foreach ($index in 1..10) {
        $column = 'Benutzerfeld_{0:D2}' -f $index
        if ($row[$column] -ne [DBNull]::Value -and -not [string]::IsNullOrWhiteSpace([string]$row[$column])) {
          $customFields[$column] = [string]$row[$column]
        }
      }
      $member = [ordered]@{}
      foreach ($column in $table.Columns) {
        if ($column.ColumnName -like 'Benutzerfeld_*') { continue }
        $value = $row[$column.ColumnName]
        $member[$column.ColumnName] = if ($value -eq [DBNull]::Value) { $null } else { $value }
      }
      $member.customFields = $customFields | ConvertTo-Json -Compress
      $members += [PSCustomObject]$member
    }
    return $members
  }
  finally { $connection.Dispose() }
}

function Assert-Authorized([System.Net.HttpListenerContext]$context) {
  $expected = "Bearer $($config.Token)"
  $provided = $context.Request.Headers['Authorization']
  if ($provided -cne $expected) {
    $context.Response.StatusCode = 401
    $context.Response.Close()
    return $false
  }
  return $true
}

function Send-Json([System.Net.HttpListenerContext]$context, [int]$status, $value) {
  $json = $value | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'application/json; charset=utf-8'
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

function Copy-SpgFiles([string]$destination) {
  foreach ($directory in @('listen', 'bausteine', 'briefe', 'etikett', 'formular')) {
    $source = Join-Path $config.SpgDataRoot $directory
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
      throw "SPG-Verzeichnis fehlt: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $destination $directory) -Recurse
  }
  $history = Join-Path $config.SpgDataRoot "mandanten\$($config.Mandant)\dta-historie"
  $historyDestination = Join-Path $destination "mandanten\$($config.Mandant)"
  New-Item -ItemType Directory -Path $historyDestination -Force | Out-Null
  if (Test-Path -LiteralPath $history -PathType Container) {
    Copy-Item -LiteralPath $history -Destination $historyDestination -Recurse
  }
}

function New-SpgBackup {
  $compatibility = Get-Compatibility
  if (-not $compatibility.compatible) {
    throw "Kompatibilitaetspruefung fehlgeschlagen: SQL Server 12 und Datenbankformat 782 sind erforderlich."
  }
  $now = Get-Date
  $stamp = $now.ToString('yyyyMMdd_HHmmss')
  $zipStamp = $now.ToString('yyyyMMddHHmmss')
  $work = Join-Path $config.WorkRoot ([Guid]::NewGuid().ToString('N'))
  $payload = Join-Path $work 'payload'
  New-Item -ItemType Directory -Path $payload -Force | Out-Null
  try {
    $bakName = "spg_verein_$($config.Mandant)_$stamp.bak"
    $bakPath = Join-Path $payload $bakName
    $connection = Open-SqlConnection
    try {
      $escapedPath = $bakPath.Replace("'", "''")
      $command = $connection.CreateCommand()
      $command.CommandTimeout = 600
      $command.CommandText = "BACKUP DATABASE [$($config.Database)] TO DISK = N'$escapedPath' WITH COPY_ONLY, INIT, CHECKSUM"
      [void]$command.ExecuteNonQuery()
    }
    finally { $connection.Dispose() }

    Copy-SpgFiles -destination $payload
    $restoreInfo = @(
      "BackUpDate:$($now.ToString('yyyyMMddHHmmss'))",
      "MandantKZ:$($config.Mandant)",
      "BestandDBsichern:True",
      "BestandDateiensichern:True",
      "ListenSichern:True",
      "BriefeSichern:True",
      "EtikettenSichern:True",
      "FormulareSichern:True",
      "BestandDBname:$bakName",
      "Serverversion:12",
      "Datenversion:432"
    ) -join "`r`n"
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText((Join-Path $payload 'restoreInfo.txt'), "$restoreInfo`r`n", $utf8WithoutBom)

    $zipPath = Join-Path $work "$($config.Mandant)_$zipStamp.zip"
    [System.IO.Compression.ZipFile]::CreateFromDirectory($payload, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    return $zipPath
  }
  catch {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    throw
  }
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  try {
    if (-not (Assert-Authorized $context)) { continue }
    $path = $context.Request.Url.AbsolutePath
    if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/api/health') {
      Send-Json $context 200 (Get-Compatibility)
      continue
    }
    if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/api/members') {
      Send-Json $context 200 @{ members = @(Get-SpgMembers) }
      continue
    }
    if ($context.Request.HttpMethod -eq 'POST' -and $path -eq '/api/members/sync') {
      $payload = Read-RequestJson $context.Request
      Send-Json $context 200 (Sync-SpgMembers $payload)
      continue
    }
    if ($context.Request.HttpMethod -eq 'POST' -and $path -eq '/api/backups') {
      $zipPath = New-SpgBackup
      try {
        $bytes = [System.IO.File]::ReadAllBytes($zipPath)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'application/zip'
        $context.Response.Headers['Content-Disposition'] = "attachment; filename=`"$([System.IO.Path]::GetFileName($zipPath))`""
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
      }
      finally { Remove-Item -LiteralPath (Split-Path $zipPath -Parent) -Recurse -Force }
      continue
    }
    Send-Json $context 404 @{ error = 'Nicht gefunden.' }
  }
  catch {
    if ($context.Response.OutputStream.CanWrite) {
      Send-Json $context 500 @{ error = $_.Exception.Message }
    }
  }
}
