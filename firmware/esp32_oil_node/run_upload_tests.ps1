Write-Host "Creating test files..."
node generate_test_files.js

Write-Host "Uploading small file (should succeed)..."
$small = "small.jpg"
Invoke-RestMethod -Uri http://localhost:8081/upload-wallpaper -Method Post -InFile $small -ContentType "multipart/form-data; boundary=------------------------$(New-Guid)" -UseBasicParsing -OutVariable res1
Write-Host "Response (small):"; $res1

Write-Host "Uploading large file (should be rejected with 413)..."
$large = "large.jpg"
try {
  # Use curl for the large file because Invoke-RestMethod may not surface HTTP 413 easily
  curl -i -F "file=@$large" http://localhost:8081/upload-wallpaper
} catch {
  Write-Host "Curl error" $_
}

Write-Host `"Fetching /wallpaper-info`"
curl -s http://localhost:8081/wallpaper-info | ConvertFrom-Json | Format-List
