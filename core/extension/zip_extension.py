import zipfile
import os

def zipdir(path, ziph):
    # ziph is zipfile handle
    for root, dirs, files in os.walk(path):
        # Exclude node_modules and other unwanted dirs
        dirs[:] = [d for d in dirs if d not in ['node_modules', 'tests', 'test', '.git', 'bypass-subtitles-extension.zip', 'store_assets']]
        
        for file in files:
            if file in ['package-lock.json', 'zip_extension.py', 'bypass-subtitles-extension.zip', '.DS_Store']:
                continue
            if file.endswith('.zip') or file.endswith('.py'):
                continue
                
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, os.path.join(path, '.'))
            ziph.write(file_path, arcname)

if __name__ == '__main__':
    with zipfile.ZipFile('bypass-subtitles-extension.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipdir('.', zipf)
    print("Zipped extension successfully.")
