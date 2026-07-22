/**
 * International dialing codes for WhatsApp OTP login.
 * Default: Iraq (+964).
 */

export type PhoneCountry = {
  iso: string;
  name: string;
  dial: string; // digits only, no +
  flag: string;
};

export const DEFAULT_PHONE_COUNTRY_ISO = "IQ";

/** Full country calling-code list (common ISO set). */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: "AF", name: "Afghanistan", dial: "93", flag: "🇦🇫" },
  { iso: "AL", name: "Albania", dial: "355", flag: "🇦🇱" },
  { iso: "DZ", name: "Algeria", dial: "213", flag: "🇩🇿" },
  { iso: "AD", name: "Andorra", dial: "376", flag: "🇦🇩" },
  { iso: "AO", name: "Angola", dial: "244", flag: "🇦🇴" },
  { iso: "AR", name: "Argentina", dial: "54", flag: "🇦🇷" },
  { iso: "AM", name: "Armenia", dial: "374", flag: "🇦🇲" },
  { iso: "AU", name: "Australia", dial: "61", flag: "🇦🇺" },
  { iso: "AT", name: "Austria", dial: "43", flag: "🇦🇹" },
  { iso: "AZ", name: "Azerbaijan", dial: "994", flag: "🇦🇿" },
  { iso: "BH", name: "Bahrain", dial: "973", flag: "🇧🇭" },
  { iso: "BD", name: "Bangladesh", dial: "880", flag: "🇧🇩" },
  { iso: "BY", name: "Belarus", dial: "375", flag: "🇧🇾" },
  { iso: "BE", name: "Belgium", dial: "32", flag: "🇧🇪" },
  { iso: "BZ", name: "Belize", dial: "501", flag: "🇧🇿" },
  { iso: "BJ", name: "Benin", dial: "229", flag: "🇧🇯" },
  { iso: "BT", name: "Bhutan", dial: "975", flag: "🇧🇹" },
  { iso: "BO", name: "Bolivia", dial: "591", flag: "🇧🇴" },
  { iso: "BA", name: "Bosnia", dial: "387", flag: "🇧🇦" },
  { iso: "BW", name: "Botswana", dial: "267", flag: "🇧🇼" },
  { iso: "BR", name: "Brazil", dial: "55", flag: "🇧🇷" },
  { iso: "BN", name: "Brunei", dial: "673", flag: "🇧🇳" },
  { iso: "BG", name: "Bulgaria", dial: "359", flag: "🇧🇬" },
  { iso: "BF", name: "Burkina Faso", dial: "226", flag: "🇧🇫" },
  { iso: "BI", name: "Burundi", dial: "257", flag: "🇧🇮" },
  { iso: "KH", name: "Cambodia", dial: "855", flag: "🇰🇭" },
  { iso: "CM", name: "Cameroon", dial: "237", flag: "🇨🇲" },
  { iso: "CA", name: "Canada", dial: "1", flag: "🇨🇦" },
  { iso: "CV", name: "Cape Verde", dial: "238", flag: "🇨🇻" },
  { iso: "CF", name: "Central African Rep.", dial: "236", flag: "🇨🇫" },
  { iso: "TD", name: "Chad", dial: "235", flag: "🇹🇩" },
  { iso: "CL", name: "Chile", dial: "56", flag: "🇨🇱" },
  { iso: "CN", name: "China", dial: "86", flag: "🇨🇳" },
  { iso: "CO", name: "Colombia", dial: "57", flag: "🇨🇴" },
  { iso: "KM", name: "Comoros", dial: "269", flag: "🇰🇲" },
  { iso: "CG", name: "Congo", dial: "242", flag: "🇨🇬" },
  { iso: "CD", name: "Congo (DRC)", dial: "243", flag: "🇨🇩" },
  { iso: "CR", name: "Costa Rica", dial: "506", flag: "🇨🇷" },
  { iso: "CI", name: "Côte d'Ivoire", dial: "225", flag: "🇨🇮" },
  { iso: "HR", name: "Croatia", dial: "385", flag: "🇭🇷" },
  { iso: "CU", name: "Cuba", dial: "53", flag: "🇨🇺" },
  { iso: "CY", name: "Cyprus", dial: "357", flag: "🇨🇾" },
  { iso: "CZ", name: "Czechia", dial: "420", flag: "🇨🇿" },
  { iso: "DK", name: "Denmark", dial: "45", flag: "🇩🇰" },
  { iso: "DJ", name: "Djibouti", dial: "253", flag: "🇩🇯" },
  { iso: "DO", name: "Dominican Rep.", dial: "1", flag: "🇩🇴" },
  { iso: "EC", name: "Ecuador", dial: "593", flag: "🇪🇨" },
  { iso: "EG", name: "Egypt", dial: "20", flag: "🇪🇬" },
  { iso: "SV", name: "El Salvador", dial: "503", flag: "🇸🇻" },
  { iso: "GQ", name: "Equatorial Guinea", dial: "240", flag: "🇬🇶" },
  { iso: "ER", name: "Eritrea", dial: "291", flag: "🇪🇷" },
  { iso: "EE", name: "Estonia", dial: "372", flag: "🇪🇪" },
  { iso: "SZ", name: "Eswatini", dial: "268", flag: "🇸🇿" },
  { iso: "ET", name: "Ethiopia", dial: "251", flag: "🇪🇹" },
  { iso: "FJ", name: "Fiji", dial: "679", flag: "🇫🇯" },
  { iso: "FI", name: "Finland", dial: "358", flag: "🇫🇮" },
  { iso: "FR", name: "France", dial: "33", flag: "🇫🇷" },
  { iso: "GA", name: "Gabon", dial: "241", flag: "🇬🇦" },
  { iso: "GM", name: "Gambia", dial: "220", flag: "🇬🇲" },
  { iso: "GE", name: "Georgia", dial: "995", flag: "🇬🇪" },
  { iso: "DE", name: "Germany", dial: "49", flag: "🇩🇪" },
  { iso: "GH", name: "Ghana", dial: "233", flag: "🇬🇭" },
  { iso: "GR", name: "Greece", dial: "30", flag: "🇬🇷" },
  { iso: "GT", name: "Guatemala", dial: "502", flag: "🇬🇹" },
  { iso: "GN", name: "Guinea", dial: "224", flag: "🇬🇳" },
  { iso: "GW", name: "Guinea-Bissau", dial: "245", flag: "🇬🇼" },
  { iso: "GY", name: "Guyana", dial: "592", flag: "🇬🇾" },
  { iso: "HT", name: "Haiti", dial: "509", flag: "🇭🇹" },
  { iso: "HN", name: "Honduras", dial: "504", flag: "🇭🇳" },
  { iso: "HK", name: "Hong Kong", dial: "852", flag: "🇭🇰" },
  { iso: "HU", name: "Hungary", dial: "36", flag: "🇭🇺" },
  { iso: "IS", name: "Iceland", dial: "354", flag: "🇮🇸" },
  { iso: "IN", name: "India", dial: "91", flag: "🇮🇳" },
  { iso: "ID", name: "Indonesia", dial: "62", flag: "🇮🇩" },
  { iso: "IR", name: "Iran", dial: "98", flag: "🇮🇷" },
  { iso: "IQ", name: "Iraq", dial: "964", flag: "🇮🇶" },
  { iso: "IE", name: "Ireland", dial: "353", flag: "🇮🇪" },
  { iso: "IL", name: "Israel", dial: "972", flag: "🇮🇱" },
  { iso: "IT", name: "Italy", dial: "39", flag: "🇮🇹" },
  { iso: "JM", name: "Jamaica", dial: "1", flag: "🇯🇲" },
  { iso: "JP", name: "Japan", dial: "81", flag: "🇯🇵" },
  { iso: "JO", name: "Jordan", dial: "962", flag: "🇯🇴" },
  { iso: "KZ", name: "Kazakhstan", dial: "7", flag: "🇰🇿" },
  { iso: "KE", name: "Kenya", dial: "254", flag: "🇰🇪" },
  { iso: "KW", name: "Kuwait", dial: "965", flag: "🇰🇼" },
  { iso: "KG", name: "Kyrgyzstan", dial: "996", flag: "🇰🇬" },
  { iso: "LA", name: "Laos", dial: "856", flag: "🇱🇦" },
  { iso: "LV", name: "Latvia", dial: "371", flag: "🇱🇻" },
  { iso: "LB", name: "Lebanon", dial: "961", flag: "🇱🇧" },
  { iso: "LS", name: "Lesotho", dial: "266", flag: "🇱🇸" },
  { iso: "LR", name: "Liberia", dial: "231", flag: "🇱🇷" },
  { iso: "LY", name: "Libya", dial: "218", flag: "🇱🇾" },
  { iso: "LI", name: "Liechtenstein", dial: "423", flag: "🇱🇮" },
  { iso: "LT", name: "Lithuania", dial: "370", flag: "🇱🇹" },
  { iso: "LU", name: "Luxembourg", dial: "352", flag: "🇱🇺" },
  { iso: "MO", name: "Macau", dial: "853", flag: "🇲🇴" },
  { iso: "MG", name: "Madagascar", dial: "261", flag: "🇲🇬" },
  { iso: "MW", name: "Malawi", dial: "265", flag: "🇲🇼" },
  { iso: "MY", name: "Malaysia", dial: "60", flag: "🇲🇾" },
  { iso: "MV", name: "Maldives", dial: "960", flag: "🇲🇻" },
  { iso: "ML", name: "Mali", dial: "223", flag: "🇲🇱" },
  { iso: "MT", name: "Malta", dial: "356", flag: "🇲🇹" },
  { iso: "MR", name: "Mauritania", dial: "222", flag: "🇲🇷" },
  { iso: "MU", name: "Mauritius", dial: "230", flag: "🇲🇺" },
  { iso: "MX", name: "Mexico", dial: "52", flag: "🇲🇽" },
  { iso: "MD", name: "Moldova", dial: "373", flag: "🇲🇩" },
  { iso: "MC", name: "Monaco", dial: "377", flag: "🇲🇨" },
  { iso: "MN", name: "Mongolia", dial: "976", flag: "🇲🇳" },
  { iso: "ME", name: "Montenegro", dial: "382", flag: "🇲🇪" },
  { iso: "MA", name: "Morocco", dial: "212", flag: "🇲🇦" },
  { iso: "MZ", name: "Mozambique", dial: "258", flag: "🇲🇿" },
  { iso: "MM", name: "Myanmar", dial: "95", flag: "🇲🇲" },
  { iso: "NA", name: "Namibia", dial: "264", flag: "🇳🇦" },
  { iso: "NP", name: "Nepal", dial: "977", flag: "🇳🇵" },
  { iso: "NL", name: "Netherlands", dial: "31", flag: "🇳🇱" },
  { iso: "NZ", name: "New Zealand", dial: "64", flag: "🇳🇿" },
  { iso: "NI", name: "Nicaragua", dial: "505", flag: "🇳🇮" },
  { iso: "NE", name: "Niger", dial: "227", flag: "🇳🇪" },
  { iso: "NG", name: "Nigeria", dial: "234", flag: "🇳🇬" },
  { iso: "KP", name: "North Korea", dial: "850", flag: "🇰🇵" },
  { iso: "MK", name: "North Macedonia", dial: "389", flag: "🇲🇰" },
  { iso: "NO", name: "Norway", dial: "47", flag: "🇳🇴" },
  { iso: "OM", name: "Oman", dial: "968", flag: "🇴🇲" },
  { iso: "PK", name: "Pakistan", dial: "92", flag: "🇵🇰" },
  { iso: "PS", name: "Palestine", dial: "970", flag: "🇵🇸" },
  { iso: "PA", name: "Panama", dial: "507", flag: "🇵🇦" },
  { iso: "PG", name: "Papua New Guinea", dial: "675", flag: "🇵🇬" },
  { iso: "PY", name: "Paraguay", dial: "595", flag: "🇵🇾" },
  { iso: "PE", name: "Peru", dial: "51", flag: "🇵🇪" },
  { iso: "PH", name: "Philippines", dial: "63", flag: "🇵🇭" },
  { iso: "PL", name: "Poland", dial: "48", flag: "🇵🇱" },
  { iso: "PT", name: "Portugal", dial: "351", flag: "🇵🇹" },
  { iso: "QA", name: "Qatar", dial: "974", flag: "🇶🇦" },
  { iso: "RO", name: "Romania", dial: "40", flag: "🇷🇴" },
  { iso: "RU", name: "Russia", dial: "7", flag: "🇷🇺" },
  { iso: "RW", name: "Rwanda", dial: "250", flag: "🇷🇼" },
  { iso: "SA", name: "Saudi Arabia", dial: "966", flag: "🇸🇦" },
  { iso: "SN", name: "Senegal", dial: "221", flag: "🇸🇳" },
  { iso: "RS", name: "Serbia", dial: "381", flag: "🇷🇸" },
  { iso: "SC", name: "Seychelles", dial: "248", flag: "🇸🇨" },
  { iso: "SL", name: "Sierra Leone", dial: "232", flag: "🇸🇱" },
  { iso: "SG", name: "Singapore", dial: "65", flag: "🇸🇬" },
  { iso: "SK", name: "Slovakia", dial: "421", flag: "🇸🇰" },
  { iso: "SI", name: "Slovenia", dial: "386", flag: "🇸🇮" },
  { iso: "SO", name: "Somalia", dial: "252", flag: "🇸🇴" },
  { iso: "ZA", name: "South Africa", dial: "27", flag: "🇿🇦" },
  { iso: "KR", name: "South Korea", dial: "82", flag: "🇰🇷" },
  { iso: "SS", name: "South Sudan", dial: "211", flag: "🇸🇸" },
  { iso: "ES", name: "Spain", dial: "34", flag: "🇪🇸" },
  { iso: "LK", name: "Sri Lanka", dial: "94", flag: "🇱🇰" },
  { iso: "SD", name: "Sudan", dial: "249", flag: "🇸🇩" },
  { iso: "SR", name: "Suriname", dial: "597", flag: "🇸🇷" },
  { iso: "SE", name: "Sweden", dial: "46", flag: "🇸🇪" },
  { iso: "CH", name: "Switzerland", dial: "41", flag: "🇨🇭" },
  { iso: "SY", name: "Syria", dial: "963", flag: "🇸🇾" },
  { iso: "TW", name: "Taiwan", dial: "886", flag: "🇹🇼" },
  { iso: "TJ", name: "Tajikistan", dial: "992", flag: "🇹🇯" },
  { iso: "TZ", name: "Tanzania", dial: "255", flag: "🇹🇿" },
  { iso: "TH", name: "Thailand", dial: "66", flag: "🇹🇭" },
  { iso: "TL", name: "Timor-Leste", dial: "670", flag: "🇹🇱" },
  { iso: "TG", name: "Togo", dial: "228", flag: "🇹🇬" },
  { iso: "TN", name: "Tunisia", dial: "216", flag: "🇹🇳" },
  { iso: "TR", name: "Turkey", dial: "90", flag: "🇹🇷" },
  { iso: "TM", name: "Turkmenistan", dial: "993", flag: "🇹🇲" },
  { iso: "UG", name: "Uganda", dial: "256", flag: "🇺🇬" },
  { iso: "UA", name: "Ukraine", dial: "380", flag: "🇺🇦" },
  { iso: "AE", name: "United Arab Emirates", dial: "971", flag: "🇦🇪" },
  { iso: "GB", name: "United Kingdom", dial: "44", flag: "🇬🇧" },
  { iso: "US", name: "United States", dial: "1", flag: "🇺🇸" },
  { iso: "UY", name: "Uruguay", dial: "598", flag: "🇺🇾" },
  { iso: "UZ", name: "Uzbekistan", dial: "998", flag: "🇺🇿" },
  { iso: "VE", name: "Venezuela", dial: "58", flag: "🇻🇪" },
  { iso: "VN", name: "Vietnam", dial: "84", flag: "🇻🇳" },
  { iso: "YE", name: "Yemen", dial: "967", flag: "🇾🇪" },
  { iso: "ZM", name: "Zambia", dial: "260", flag: "🇿🇲" },
  { iso: "ZW", name: "Zimbabwe", dial: "263", flag: "🇿🇼" },
];

export function getDefaultPhoneCountry(): PhoneCountry {
  return (
    PHONE_COUNTRIES.find((c) => c.iso === DEFAULT_PHONE_COUNTRY_ISO) ||
    PHONE_COUNTRIES[0]
  );
}

/** Iraq first, then A–Z by name. */
export function phoneCountriesIraqFirst(): PhoneCountry[] {
  const iraq = getDefaultPhoneCountry();
  const rest = PHONE_COUNTRIES.filter((c) => c.iso !== iraq.iso).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return [iraq, ...rest];
}

/** Build E.164-ish phone: +<dial><national> (strips leading 0 from national). */
export function buildInternationalPhone(
  dial: string,
  nationalInput: string
): string {
  let national = nationalInput.replace(/\D/g, "");
  const dialDigits = dial.replace(/\D/g, "");

  // If user pasted a full international number, keep it.
  if (national.startsWith("00")) national = national.slice(2);
  if (national.startsWith(dialDigits)) {
    return `+${national}`;
  }
  if (national.startsWith("0")) national = national.slice(1);

  return `+${dialDigits}${national}`;
}
