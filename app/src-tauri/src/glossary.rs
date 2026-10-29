//! The glossary (Settings › Transcripció › Glossari): names and brands the transcription should
//! write the way the user does. Every finished sentence, live or from Whisper, goes through
//! `correct`, which gives the glossary's spelling to words that read the same once accents,
//! capitals, apostrophes and spaces are ignored ("Wordpress", "soft català", "d'aïna"), or that
//! are a letter or two away in a long word ("wordpres"). Short words only change on an exact
//! match, so "eina" never becomes "AINA".
//!
//! Whisper's initial prompt was tried first and left out: it fixed some names but dropped words
//! and changed others (docs/ARQUITECTURA.md).

/// Most words a term can be heard as ("woo commerce", "guillem puig", "soft cata là").
const MAX_SPLIT: usize = 3;

struct Term<'a> {
    text: &'a str,
    key: Vec<char>,
}

/// `text` with the glossary's spelling. Unchanged if nothing matches.
pub fn correct(text: &str, glossary: &[String]) -> String {
    let terms: Vec<Term> = glossary
        .iter()
        .map(|t| t.trim())
        .filter_map(|text| {
            let key = fold(text);
            (!key.is_empty()).then_some(Term { text, key })
        })
        .collect();
    if terms.is_empty() {
        return text.to_string();
    }
    let words: Vec<Word> = text.split_whitespace().map(Word::parse).collect();
    let mut out: Vec<String> = Vec::with_capacity(words.len());
    let mut changed = false;
    let mut i = 0;
    while i < words.len() {
        // The closest match starting at this word; on a tie, the fewest words ("Wordpress o" is
        // "Wordpress" and "o", not "Wordpresso").
        let mut best: Option<(usize, usize, &Term)> = None;
        // "daina": an elision the live engine wrote without its apostrophe.
        let mut elided: Option<&Term> = None;
        for n in 1..=MAX_SPLIT.min(words.len() - i) {
            let group = &words[i..i + n];
            // A term heard as several words doesn't cross punctuation.
            if group[..n - 1].iter().any(|w| !w.after.is_empty()) || group[1..].iter().any(|w| !w.before.is_empty()) {
                break;
            }
            let key: Vec<char> = group.iter().flat_map(|w| fold(w.core)).collect();
            for term in &terms {
                if let Some(d) = closeness(&key, &term.key) {
                    if best.is_none_or(|(_, bd, _)| d < bd) {
                        best = Some((n, d, term));
                    }
                }
                if n == 1 && words[i].before.is_empty() && elides(&key, term) {
                    elided = Some(term);
                }
            }
        }
        if let (None, Some(term)) = (best, elided) {
            let word = &words[i];
            let letter = word.core.chars().next().unwrap();
            out.push(format!("{letter}'{}{}", term.text, word.after));
            changed = true;
            i += 1;
            continue;
        }
        match best {
            Some((n, _, term)) if !(n == 1 && words[i].core == term.text) => {
                let (first, last) = (&words[i], &words[i + n - 1]);
                out.push(format!("{}{}{}", first.before, term.text, last.after));
                changed = true;
                i += n;
            }
            _ => {
                out.push(words[i].whole.to_string());
                i += 1;
            }
        }
    }
    if changed { out.join(" ") } else { text.to_string() }
}

/// A word split around what the glossary compares: `before` (opening marks, "d'", "l'"…),
/// `core`, and `after` (closing marks).
struct Word<'a> {
    whole: &'a str,
    before: &'a str,
    core: &'a str,
    after: &'a str,
}

impl<'a> Word<'a> {
    fn parse(whole: &'a str) -> Self {
        let start = whole.find(|c: char| c.is_alphanumeric()).unwrap_or(whole.len());
        let end = whole.rfind(|c: char| c.is_alphanumeric()).map_or(start, |i| i + whole[i..].chars().next().unwrap().len_utf8());
        let mut start = start;
        // Elision: "d'", "l'", "s'", "qu'"… stays in front of the term.
        if let Some(at) = whole[start..end].find(['\'', '’']) {
            let quote = start + at;
            let next = quote + whole[quote..].chars().next().unwrap().len_utf8();
            if (1..=2).contains(&whole[start..quote].chars().count()) && next < end {
                start = next;
            }
        }
        Word { whole, before: &whole[..start], core: &whole[start..end], after: &whole[end..] }
    }
}

/// Lowercase letters and digits without accents: "Soft Català" → "softcatala".
fn fold(s: &str) -> Vec<char> {
    s.chars()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        })
        .collect()
}

/// How many letters apart `heard` is from `term` once folded, if close enough: none for a short
/// term, one for a long one that starts the same, two for a very long one.
fn closeness(heard: &[char], term: &[char]) -> Option<usize> {
    if heard == term {
        return Some(0);
    }
    let allowed = match term.len() {
        0..7 => return None,
        7..12 => 1,
        _ => 2,
    };
    if heard.first() != term.first() || heard.len().abs_diff(term.len()) > allowed {
        return None;
    }
    Some(distance(heard, term)).filter(|&d| d <= allowed)
}

/// `heard` is d', l', s', m', n' or t' stuck to a term that starts with a vowel or h.
fn elides(heard: &[char], term: &Term) -> bool {
    let starts_open = term.key.first().is_some_and(|c| "aeiouh".contains(*c));
    starts_open && heard.len() == term.key.len() + 1 && "dlsmnt".contains(heard[0]) && heard[1..] == term.key[..]
}

/// Levenshtein distance.
fn distance(a: &[char], b: &[char]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != cb)).min(above + 1).min(row[j] + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glossary() -> Vec<String> {
        ["AINA", "Softcatalà", "WordPress", "WooCommerce", "Guillem Puig"].map(String::from).to_vec()
    }

    #[test]
    fn fixes_what_the_transcription_gets_wrong() {
        let g = glossary();
        assert_eq!(correct("el traductor és el d'aïna.", &g), "el traductor és el d'AINA.");
        assert_eq!(correct("semblant al de soft català. Ja està.", &g), "semblant al de Softcatalà. Ja està.");
        assert_eq!(correct("enganxar-lo a sob català, sinó que", &g), "enganxar-lo a sob català, sinó que");
        assert_eq!(correct("gent que tingui Wordpress o", &g), "gent que tingui WordPress o");
        assert_eq!(correct("la botiga amb woo commerce,", &g), "la botiga amb WooCommerce,");
        assert_eq!(correct("feta amb wordpres?", &g), "feta amb WordPress?");
        assert_eq!(correct("com deia el guillem puig", &g), "com deia el Guillem Puig");
        assert_eq!(correct("(«softcatala»)", &g), "(«Softcatalà»)");
        assert_eq!(correct("el traductor és el daina però", &g), "el traductor és el d'AINA però");
        assert_eq!(correct("gent que tingui un wordpress o", &g), "gent que tingui un WordPress o");
    }

    #[test]
    fn leaves_the_rest_alone() {
        let g = glossary();
        let text = "Això és una eina, i la web  està feta.";
        assert_eq!(correct(text, &g), text);
        // Not across punctuation.
        assert_eq!(correct("soft. Català", &g), "soft. Català");
        // Short words need an exact match.
        assert_eq!(correct("aines", &["AINA".to_string()]), "aines");
        // An elision only before a vowel or h.
        assert_eq!(correct("dpau", &["Pau".to_string()]), "dpau");
        assert_eq!(correct("WordPress", &g), "WordPress");
        assert_eq!(correct("", &g), "");
        assert_eq!(correct("res", &[]), "res");
    }
}
