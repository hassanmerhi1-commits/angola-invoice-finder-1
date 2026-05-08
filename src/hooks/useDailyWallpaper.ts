// Daily rotating wallpaper hook for historic Angolan landmarks
import day1 from '@/assets/wallpapers/day-1-fortaleza-sao-miguel.jpg';
import day2 from '@/assets/wallpapers/day-2-cristo-rei.jpg';
import day3 from '@/assets/wallpapers/day-3-serra-da-leba.jpg';
import day4 from '@/assets/wallpapers/day-4-kalandula-falls.jpg';
import day5 from '@/assets/wallpapers/day-5-igreja-remedios.jpg';
import day6 from '@/assets/wallpapers/day-6-miradouro-lua.jpg';
import day7 from '@/assets/wallpapers/day-7-cidade-alta.jpg';
import { useTranslation } from '@/i18n';

export interface WallpaperInfo {
  image: string;
  name: string;
  location: string;
  description: string;
}

const wallpaperDefs = [
  {
    image: day1,
    location: 'Luanda',
    nameKey: 'day1Name',
    descriptionKey: 'day1Description',
  },
  {
    image: day2,
    location: 'Lubango',
    nameKey: 'day2Name',
    descriptionKey: 'day2Description',
  },
  {
    image: day3,
    location: 'Lubango',
    nameKey: 'day3Name',
    descriptionKey: 'day3Description',
  },
  {
    image: day4,
    location: 'Malanje',
    nameKey: 'day4Name',
    descriptionKey: 'day4Description',
  },
  {
    image: day5,
    location: 'Luanda',
    nameKey: 'day5Name',
    descriptionKey: 'day5Description',
  },
  {
    image: day6,
    location: 'Luanda',
    nameKey: 'day6Name',
    descriptionKey: 'day6Description',
  },
  {
    image: day7,
    location: 'Luanda',
    nameKey: 'day7Name',
    descriptionKey: 'day7Description',
  },
];

export function useDailyWallpaper(): WallpaperInfo {
  const { t } = useTranslation();

  const wallpapers: WallpaperInfo[] = wallpaperDefs.map((w: any) => ({
    image: w.image,
    location: w.location,
    name: t.wallpaperUi[w.nameKey],
    description: t.wallpaperUi[w.descriptionKey],
  }));

  // Get the day of the week (0 = Sunday, 1 = Monday, etc.)
  const dayOfWeek = new Date().getDay();
  
  // Map to wallpaper index (Sunday = 0 maps to wallpaper 0, etc.)
  // This ensures the wallpaper changes every day
  const wallpaperIndex = dayOfWeek % wallpapers.length;
  
  return wallpapers[wallpaperIndex];
}

export function getAllWallpapers(): WallpaperInfo[] {
  return wallpaperDefs.map((w: any) => ({
    image: w.image,
    location: w.location,
    name: String(w.nameKey),
    description: String(w.descriptionKey),
  }));
}
