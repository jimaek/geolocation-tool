import { countries, continents } from 'countries-list';

export const CONTINENTS = [
  { code: 'AF', name: continents.AF, magic: 'africa' },
  { code: 'AS', name: continents.AS, magic: 'asia' },
  { code: 'EU', name: continents.EU, magic: 'europe' },
  { code: 'NA', name: continents.NA, magic: 'north america' },
  { code: 'OC', name: continents.OC, magic: 'oceania' },
  { code: 'SA', name: continents.SA, magic: 'south america' }
];

const US_STATES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'District of Columbia', 'PR': 'Puerto Rico', 'VI': 'U.S. Virgin Islands',
  'GU': 'Guam', 'AS': 'American Samoa', 'MP': 'Northern Mariana Islands'
};

export function getCountryName(code: string): string {
  return countries[code as keyof typeof countries]?.name || code;
}

export function getCountryContinent(code: string): string | null {
  const country = countries[code as keyof typeof countries];
  return country?.continent || null;
}

export function getStateName(code: string): string {
  return US_STATES[code] || code;
}
