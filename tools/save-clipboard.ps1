Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $bmp = New-Object System.Drawing.Bitmap($img)
    $bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $img.Dispose()
    Write-Output "saved"
} else {
    Write-Output "no image in clipboard"
}
