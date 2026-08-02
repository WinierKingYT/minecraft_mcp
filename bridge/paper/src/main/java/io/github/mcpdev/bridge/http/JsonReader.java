package io.github.mcpdev.bridge.http;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sınırlı ve katı JSON okuyucu.
 *
 * <p>Genel amaçlı bir JSON kütüphanesi Bridge'e bilinçli olarak girmez
 * (bkz. {@link Json}). Bu okuyucu yalnızca istek gövdelerini çözer ve saldırı
 * yüzeyini daraltan sert sınırlar taşır:
 *
 * <ul>
 *   <li>Maksimum iç içe derinlik — derinlik bombasına karşı</li>
 *   <li>Maksimum eleman sayısı — bellek şişmesine karşı</li>
 *   <li>Sondaki fazlalık içerik reddedilir — "smuggling" denemelerine karşı</li>
 *   <li>Yinelenen anahtar reddedilir — ayrıştırıcı farkı istismarına karşı</li>
 * </ul>
 *
 * <p>Sayılar tam sayıysa {@code Long}, değilse {@code Double} olarak döner;
 * blok koordinatları gibi alanlarda ondalık değer üst katmanda reddedilir.
 */
public final class JsonReader {

    public static final int MAX_DEPTH = 16;
    public static final int MAX_ELEMENTS = 512;

    private final String input;
    private int pos;
    private int elements;

    private JsonReader(String input) {
        this.input = input;
    }

    public static final class JsonParseException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        JsonParseException(String message) {
            super(message);
        }
    }

    /** Kök seviyede bir JSON nesnesi bekler. */
    public static Map<String, Object> readObject(String json) {
        JsonReader reader = new JsonReader(json);
        reader.skipWhitespace();
        Object value = reader.readValue(0);
        reader.skipWhitespace();
        if (reader.pos != reader.input.length()) {
            throw new JsonParseException("Gövdenin sonunda beklenmeyen içerik var.");
        }
        if (!(value instanceof Map)) {
            throw new JsonParseException("Kök seviyede JSON nesnesi bekleniyor.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> object = (Map<String, Object>) value;
        return object;
    }

    private Object readValue(int depth) {
        if (depth > MAX_DEPTH) {
            throw new JsonParseException("JSON iç içe derinliği " + MAX_DEPTH + " sınırını aşıyor.");
        }
        if (++elements > MAX_ELEMENTS) {
            throw new JsonParseException("JSON eleman sayısı " + MAX_ELEMENTS + " sınırını aşıyor.");
        }

        skipWhitespace();
        char c = peek();
        return switch (c) {
            case '{' -> readObjectValue(depth);
            case '[' -> readArray(depth);
            case '"' -> readString();
            case 't' -> readLiteral("true", Boolean.TRUE);
            case 'f' -> readLiteral("false", Boolean.FALSE);
            case 'n' -> readLiteral("null", null);
            default -> readNumber();
        };
    }

    private Map<String, Object> readObjectValue(int depth) {
        expect('{');
        Map<String, Object> map = new LinkedHashMap<>();
        skipWhitespace();
        if (peek() == '}') {
            pos++;
            return map;
        }
        while (true) {
            skipWhitespace();
            String key = readString();
            if (map.containsKey(key)) {
                // Yinelenen anahtar: ayrıştırıcılar arasında "ilki mi sonuncusu
                // mu kazanır" farkı istismar edilebilir.
                throw new JsonParseException("Yinelenen JSON anahtarı: " + key);
            }
            skipWhitespace();
            expect(':');
            map.put(key, readValue(depth + 1));
            skipWhitespace();
            char next = next();
            if (next == '}') {
                return map;
            }
            if (next != ',') {
                throw new JsonParseException("Nesnede ',' veya '}' bekleniyordu.");
            }
        }
    }

    private List<Object> readArray(int depth) {
        expect('[');
        List<Object> list = new ArrayList<>();
        skipWhitespace();
        if (peek() == ']') {
            pos++;
            return list;
        }
        while (true) {
            list.add(readValue(depth + 1));
            skipWhitespace();
            char next = next();
            if (next == ']') {
                return list;
            }
            if (next != ',') {
                throw new JsonParseException("Dizide ',' veya ']' bekleniyordu.");
            }
        }
    }

    private String readString() {
        expect('"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = next();
            if (c == '"') {
                return sb.toString();
            }
            if (c == '\\') {
                char esc = next();
                switch (esc) {
                    case '"' -> sb.append('"');
                    case '\\' -> sb.append('\\');
                    case '/' -> sb.append('/');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'n' -> sb.append('\n');
                    case 'r' -> sb.append('\r');
                    case 't' -> sb.append('\t');
                    case 'u' -> {
                        if (pos + 4 > input.length()) {
                            throw new JsonParseException("Eksik unicode kaçışı.");
                        }
                        String hex = input.substring(pos, pos + 4);
                        pos += 4;
                        try {
                            sb.append((char) Integer.parseInt(hex, 16));
                        } catch (NumberFormatException e) {
                            throw new JsonParseException("Geçersiz unicode kaçışı: \\u" + hex);
                        }
                    }
                    default -> throw new JsonParseException("Geçersiz kaçış: \\" + esc);
                }
            } else if (c < 0x20) {
                throw new JsonParseException("Metin içinde kaçırılmamış kontrol karakteri.");
            } else {
                sb.append(c);
            }
        }
    }

    private Object readLiteral(String literal, Object value) {
        if (!input.startsWith(literal, pos)) {
            throw new JsonParseException("Geçersiz literal, beklenen: " + literal);
        }
        pos += literal.length();
        return value;
    }

    private Object readNumber() {
        int start = pos;
        if (peek() == '-') {
            pos++;
        }
        boolean fractional = false;
        while (pos < input.length()) {
            char c = input.charAt(pos);
            if (c >= '0' && c <= '9') {
                pos++;
            } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
                fractional = true;
                pos++;
            } else {
                break;
            }
        }
        String raw = input.substring(start, pos);
        if (raw.isEmpty() || "-".equals(raw)) {
            throw new JsonParseException("Geçersiz sayı.");
        }
        try {
            return fractional ? (Object) Double.valueOf(raw) : (Object) Long.valueOf(raw);
        } catch (NumberFormatException e) {
            throw new JsonParseException("Geçersiz sayı: " + raw);
        }
    }

    private void skipWhitespace() {
        while (pos < input.length()) {
            char c = input.charAt(pos);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                pos++;
            } else {
                break;
            }
        }
    }

    private char peek() {
        if (pos >= input.length()) {
            throw new JsonParseException("Beklenmedik gövde sonu.");
        }
        return input.charAt(pos);
    }

    private char next() {
        char c = peek();
        pos++;
        return c;
    }

    private void expect(char expected) {
        char c = next();
        if (c != expected) {
            throw new JsonParseException("'" + expected + "' bekleniyordu, '" + c + "' bulundu.");
        }
    }
}
