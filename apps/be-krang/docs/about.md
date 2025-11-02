**🧠 What is NLP and what are its main functions**

NLP (Natural Language Processing) is a field that combines linguistics and machine learning to enable computers to understand text or speech.

Main NLP tasks:

- Tokenization — splitting text into words, sentences, or phrases.
- Lemmatization / Stemming — reducing words to their base form (“running” → “run”).
- Part-of-Speech Tagging (POS) — determining the role of a word in a sentence (noun, verb, adjective).
- Named Entity Recognition (NER) — detecting names of people, companies, places, dates, currencies, etc.
- Sentiment Analysis — identifying the emotional tone of the text (positive / neutral / negative).
- Text Classification / Topic Detection — classifying text by topic (sports, politics, finance, etc.).
- Keyword Extraction — identifying key words or concepts.
- Language Detection — determining the language of the text.
- Summarization — creating a short summary from a long text.
- Text Similarity / Matching — finding similar texts, duplicates, and so on.

**⚙️ How NLP works (simplified)**

You provide an input string.

The NLP pipeline processes it step by step: tokenization → morphological analysis → NER → sentiment analysis → classification.

As output, you get structured data — the text is converted into JSON with features, tags, probabilities, etc.

The final data can then be parsed using RegEx to extract specific information from the text.
