"""Read-only connectivity checks. Never print credentials or provider bodies."""
import asyncio
from pathlib import Path
import httpx
from dotenv import dotenv_values
from app.core.config import settings

ROOT = Path(__file__).resolve().parent.parent

def mobile_env():
    values = {}
    for name in ['.env', '.env.development', '.env.local', '.env.development.local']:
        values.update({k:v for k,v in dotenv_values(ROOT/'mobile'/name).items() if v is not None})
    return values

async def main():
    values = mobile_env()
    example = dotenv_values(ROOT/'mobile/.env.example')
    print('mobile_env_files:', [p.name for p in (ROOT/'mobile').glob('.env*')])
    print('api_url:', values.get('EXPO_PUBLIC_API_URL', '(not loaded)'))
    print('example_has_api_url:', bool(example.get('EXPO_PUBLIC_API_URL')))
    key = values.get('EXPO_PUBLIC_TRACKASIA_KEY')
    print('trackasia_key_loaded:', bool(key))
    print('cloudinary_configured:', all([settings.CLOUDINARY_CLOUD_NAME,settings.CLOUDINARY_API_KEY,settings.CLOUDINARY_API_SECRET]))
    async with httpx.AsyncClient(timeout=20) as client:
        checks = []
        if values.get('EXPO_PUBLIC_API_URL'):
            checks.append(('backend_health', values['EXPO_PUBLIC_API_URL'].rstrip('/')+'/health', {}))
        if key:
            checks.append(('trackasia_style','https://maps.track-asia.com/styles/v2/streets.json',dict(params={'key':key})))
        if settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET:
            checks.append(('cloudinary_account',f'https://api.cloudinary.com/v1_1/{settings.CLOUDINARY_CLOUD_NAME}/resources/image',dict(auth=(settings.CLOUDINARY_API_KEY,settings.CLOUDINARY_API_SECRET),params={'max_results':1})))
        for name, url, kwargs in checks:
            try:
                response = await client.get(url, **kwargs)
                print(name, 'HTTP', response.status_code)
                if name == 'backend_health' and response.is_success:
                    print('database:', response.json().get('database'))
            except Exception as exc:
                print(name, type(exc).__name__)

if __name__ == '__main__': asyncio.run(main())
