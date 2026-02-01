from PIL import Image
import os

files = {
    "Marquee_Promo_1400x560.png": (1400, 560),
    "Small_Promo_440x280.png": (440, 280),
    "Screenshot_1280x800.png": (1280, 800)
}

for filename, size in files.items():
    if os.path.exists(filename):
        try:
            with Image.open(filename) as img:
                 print(f"Processing {filename}...")
                 # Convert to RGB to drop alpha channel (transparency)
                 rgb_img = img.convert('RGB')
                 # Resize force
                 resized_img = rgb_img.resize(size, Image.Resampling.LANCZOS)
                 # Save as JPG
                 new_name = filename.replace(".png", ".jpg")
                 resized_img.save(new_name, "JPEG", quality=95)
                 print(f"Converted {filename} -> {new_name} ({size})")
        except Exception as e:
            print(f"Error processing {filename}: {e}")
            
