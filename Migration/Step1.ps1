$key = ''
$csUrl = ''
$ct = 'application/json'
$fullUrl = "$csUrl/api/digests?key=$key"

function saveDigests(){
  param($responseDigests, $output)

  $digests = $output.digests = @{}

  $responseDigests | % {
    $d = $digests[$_.digestId] =  @{}
    $d.digestId = $_.digestId
    $d.description = $_.description

    $fullUrl = "$csUrl/api/digests/$($d.digestId)/inboxes?key=$key"
    $response = Invoke-RestMethod -Method Get -ContentType $ct -Uri $fullUrl

    saveInboxes $response._embedded.inboxes $d
  }

}

function saveInboxes(){
  param($responseInboxes, $outputDigest)

  $outputDigest.responseInboxes = @{}

  $responseInboxes | % {
    $i = $outputDigest.responseInboxes[$_.inboxId] = @{}

    $i.inboxId = $_.inboxId
    $i.name = $_.name
    $i.url = $_.url
  }

}

$output = @{}
$response = Invoke-RestMethod -Method Get -ContentType $ct -Uri $fullUrl

saveDigests $response._embedded.digests $output

Set-Content -Path 'output.json' -Value (ConvertTo-Json $output -Depth 10)

