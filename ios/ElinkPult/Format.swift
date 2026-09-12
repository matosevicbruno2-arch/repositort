import Foundation

/// Zajedničko oblikovanje brojeva i datuma, isto kao na webu.
enum Format {
    static let hr = Locale(identifier: "hr_HR")

    static func eur(_ n: Double, decimale: Int = 2) -> String {
        let f = NumberFormatter()
        f.locale = hr
        f.numberStyle = .currency
        f.currencyCode = "EUR"
        f.maximumFractionDigits = decimale
        f.minimumFractionDigits = decimale == 0 ? 0 : 2
        return f.string(from: NSNumber(value: n)) ?? "\(n) €"
    }

    /// "2026-09-12" → Date u lokalnoj ponoći
    static func dan(_ iso: String?) -> Date? {
        guard let iso, iso.count >= 10 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(iso.prefix(10)))
    }

    /// Puni ISO 8601 zapis s vremenom (inbox, kalendar)
    static func trenutak(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    static func kratkiDatum(_ iso: String?) -> String {
        guard let d = dan(iso) else { return "—" }
        let f = DateFormatter()
        f.locale = hr
        f.setLocalizedDateFormatFromTemplate("d.M.")
        return f.string(from: d)
    }

    static func punDatum(_ iso: String?) -> String {
        guard let d = dan(iso) else { return "—" }
        let f = DateFormatter()
        f.locale = hr
        f.dateStyle = .medium
        return f.string(from: d)
    }

    static func vrijeme(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = hr
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    /// Za inbox: danas prikaži sat, inače dan i mjesec.
    static func kada(_ iso: String?) -> String {
        guard let d = trenutak(iso) else { return "" }
        if Calendar.current.isDateInToday(d) { return vrijeme(d) }
        let f = DateFormatter()
        f.locale = hr
        f.setLocalizedDateFormatFromTemplate("EEE d.M.")
        return f.string(from: d)
    }

    static func naslovDana(_ iso: String) -> String {
        guard let d = dan(iso) else { return iso }
        let f = DateFormatter()
        f.locale = hr
        f.setLocalizedDateFormatFromTemplate("EEEE d.M.")
        return f.string(from: d).capitalizedFirst
    }
}

extension String {
    var capitalizedFirst: String {
        guard let prvi = first else { return self }
        return prvi.uppercased() + dropFirst()
    }
}
