const ukrainianStopWords = new Set([
  'а',
  'аби',
  'абиде',
  'абиким',
  'абикого',
  'абикому',
  'абичим',
  'абичого',
  'абичому',
  'або',
  'але',
  'б',
  'без',
  'би',
  'біля',
  'бо',
  'був',
  'буває',
  'буде',
  'будем',
  'будемо',
  'будете',
  'будеш',
  'буду',
  'будуть',
  'будь',
  'була',
  'були',
  'було',
  'бути',
  'в',
  'вам',
  'вами',
  'вас',
  'ваш',
  'ваша',
  'ваше',
  'ваші',
  'вже',
  'ви',
  'від',
  'він',
  'вона',
  'вони',
  'воно',
  'всі',
  'всіх',
  'все',
  'всього',
  'всьому',
  'де',
  'деколи',
  'дещо',
  'для',
  'до',
  'дякую',
  'ж',
  'же',
  'з',
  'за',
  'зараз',
  'зі',
  'і',
  'із',
  'її',
  'їй',
  'їм',
  'їх',
  'їхній',
  'їхня',
  'їхнє',
  'їхні',
  'й',
  'його',
  'йому',
  'каже',
  'кажуть',
  'коли',
  'кого',
  'кому',
  'котрий',
  'котра',
  'котре',
  'котрі',
  'куди',
  'лиш',
  'лише',
  'має',
  'мають',
  'мене',
  'мені',
  'ми',
  'мною',
  'може',
  'можуть',
  'міг',
  'могла',
  'могли',
  'на',
  'навіть',
  'над',
  'нам',
  'нами',
  'нас',
  'наш',
  'наша',
  'наше',
  'наші',
  'не',
  'немає',
  'ні',
  'ніж',
  'ним',
  'ними',
  'них',
  'нього',
  'ньому',
  'ну',
  'о',
  'об',
  'один',
  'одна',
  'одне',
  'одні',
  'от',
  'отакий',
  'отака',
  'отаке',
  'отакі',
  'під',
  'після',
  'по',
  'при',
  'про',
  'ради',
  'раз',
  'рівно',
  'сам',
  'сама',
  'саме',
  'самі',
  'свій',
  'своя',
  'своє',
  'свої',
  'себе',
  'собі',
  'собою',
  'сюди',
  'та',
  'так',
  'така',
  'таке',
  'такий',
  'такі',
  'там',
  'те',
  'тебе',
  'теж',
  'тепер',
  'ти',
  'тільки',
  'то',
  'тобі',
  'тобою',
  'тоді',
  'того',
  'той',
  'тільки',
  'тому',
  'тут',
  'ти',
  'ті',
  'тієї',
  'тією',
  'тії',
  'тільки',
  'тім',
  'того',
  'тоді',
  'той',
  'том',
  'томі',
  'тому',
  'тут',
  'у',
  'уже',
  'хай',
  'хоч',
  'хто',
  'хтось',
  'це',
  'цей',
  'цим',
  'цими',
  'цих',
  'ці',
  'цій',
  'ціла',
  'ціле',
  'цілий',
  'цілі',
  'цього',
  'цьому',
  'чи',
  'чий',
  'чия',
  'чиє',
  'чиї',
  'чого',
  'чому',
  'через',
  'ще',
  'що',
  'щоб',
  'щоби',
  'як',
  'яка',
  'яке',
  'який',
  'які',
  'якої',
  'якому',
  'якщо',
  'я',
]);

function normalizeUkrainian(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[''`’]/g, '') // Remove apostrophes which are common in Ukrainian
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sа-яїієґ-]/g, '')
    .trim();
}

/**
 * A robust algorithmic stemmer for Ukrainian.
 * Unlike English, Ukrainian is highly inflected (7 cases, 3 genders, etc.),
 * so we need significantly more rules to find the word root.
 */
function lemmatizeUkrainian(word: string): string {
  let stem = word.toLowerCase();

  // Find the "Region of Variable" (RV) - part of the word after the first vowel
  const vowel = /([аеєиіїоуюя])/;
  const rvIndex = stem.search(vowel);

  // If no vowels, return the word as is (e.g. prepositions like "в", "з")
  if (rvIndex === -1) return stem;

  const head = stem.substring(0, rvIndex + 1);
  let RV = stem.substring(rvIndex + 1);

  // Step 1: Perfective Gerund
  // (e.g. написавши -> написа)
  const perfectiveGerund =
    /(?:(ив|ивши|ившись|ыв|ывши|ывшись|(?:<=[ая])(в|вши|вшись)))$/;
  if (perfectiveGerund.test(RV)) {
    RV = RV.replace(perfectiveGerund, '');
  } else {
    // Step 2: Reflexive
    // (e.g. сміявся -> сміяв)
    RV = RV.replace(/(?:ся|сь)$/, '');

    // Step 3: Adjective
    // (e.g. гарний -> гарн)
    // Removed 'им', 'ім' to preserve names like 'Вадим', 'Максим'
    // Added 'ія' to handle names like 'Сергія' -> 'Серг' (matching 'Сергій' -> 'Серг')
    const adjective =
      /(?:(ця|ька|ая|ими|ій|ий|а|е|є|їй|єє|еє|ія|я|ем|их|іх|ою|йми|іми|у|ю|ого|ому|ої|ії))$/;
    if (adjective.test(RV)) {
      RV = RV.replace(adjective, '');

      // Step 4: Participle (only if adjective was removed)
      // (e.g. читаючий -> чита)
      const participle =
        /(?:(ивш|ывш|уюч|уючи|явш|явши|ши|ем|им|ім|а|е|у|ю|их|іх|і|й|о|ш))$/;
      RV = RV.replace(participle, '');
    } else {
      // Step 5: Verb
      // (e.g. читати -> чита)
      // Removed 'ило' to prevent names like 'Кирило' from being stemmed to 'Кир'
      // Modified 'ав' to '(?<!сл)ав' to protect names like 'Владислав', 'Ярослав'
      const verb =
        /(?:(ила|ити|или|илю|иш|ите|имо|и|ив|ала|ало|ати|али|алю|аш|ате|амо|(?<!сл)ав|яла|яло|яти|яли|ялю|яш|яте|ямо|яв|у|ю|е|є|єш|єт|емо|єт|ють|ять|ймо|йте|ться))$/;
      if (verb.test(RV)) {
        RV = RV.replace(verb, '');
      } else {
        // NEW: Fleeting vowels for nouns ending in -ець/-єць
        // Гітунець -> Гітун, Коломієць -> Коломій
        if (/(?:ієць|ець|єць)$/.test(RV)) {
          RV = RV.replace(/ієць$/, '');
          RV = RV.replace(/єць$/, '');
          RV = RV.replace(/ець$/, '');
        }

        // Step 6: Noun
        // (e.g. столом -> стол)
        // Added 'єві', 'єм' for dative/instrumental cases of names like 'Сергій'
        const noun =
          /(?:(ько|ай|а|е|ями|ами|еи|и|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я|і|ові|ї|ею|єю|ою|є|еві|єві|ем|єм|ю))$/;
        RV = RV.replace(noun, '');
      }
    }
  }

  // Step 7: Derivational endings
  RV = RV.replace(/ість$/, '');

  // Step 8: Superlative
  RV = RV.replace(/^(най)/, '');

  // Step 9: Remove trailing 'ь' if remaining
  RV = RV.replace(/ь$/, '');

  return head + RV;
}

export { lemmatizeUkrainian, normalizeUkrainian, ukrainianStopWords };
