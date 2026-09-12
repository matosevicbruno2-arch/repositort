import Foundation

/// Svaki odgovor poslužitelja dolazi umotan u `data`, uz vrijeme dohvata.
struct Envelope<T: Decodable>: Decodable {
    let data: T
    let storedAt: Double?
}

struct APIError: Decodable, Error {
    struct Detail: Decodable {
        let code: String?
        let message: String
    }
    let error: Detail

    var poruka: String { error.message }
    var trebaPonovnaPrijava: Bool { error.code == "needs_reauth" || error.code == "not_authenticated" }
}

// MARK: - Pult

struct Pult: Decodable {
    let today: String
    let due: [Racun]
    let cancelled: [Storno]
    let open: [Posao]
    let toInvoice: [Posao]
    let income: Primici
    let totals: Zbrojevi
}

struct Racun: Decodable, Identifiable {
    let no: String
    let client: String
    let amount: Double
    let rok: String?
    let late: Int?
    let pdf: String?
    let date: String?

    var id: String { no }
    var kasni: Bool { (late ?? 0) > 0 }
    var storno: Bool { amount < 0 }
}

struct Storno: Decodable {
    let racun: String
    let storno: String
    let amount: Double
}

struct Posao: Decodable, Identifiable {
    let sifra: String
    let client: String
    let proj: String
    let desc: String
    let status: String
    let prio: String
    let rok: String?
    let val: Double?
    let entered: String?
    let done: String?
    let toInv: Double?
    let note: String?

    // Šifra iz tablice ne mora biti popunjena, pa se identitet slaže iz više polja.
    var id: String { "\(sifra)|\(client)|\(proj)" }
    var iznos: Double? { val ?? toInv }

    enum CodingKeys: String, CodingKey {
        case sifra = "id"
        case client, proj, desc, status, prio, rok, val, entered, done, toInv, note
    }
}

struct Primici: Decodable {
    let byMonth: [Mjesec]
    let paidTotal: Double
}

struct Mjesec: Decodable {
    let mjesec: String
    let iznos: Double
}

struct Zbrojevi: Decodable {
    let dueSum: Double
    let dueOverdue: Double
    let overdueCount: Int
    let openValue: Double
    let invoiceSum: Double
}

// MARK: - Inbox

struct Poruka: Decodable, Identifiable {
    let id: String
    let sender: String
    let subject: String
    let snippet: String
    let date: String?
    let unread: Bool
    let count: Int
    let cat: String

    /// "Ime Prezime <adresa>" → "Ime Prezime"
    var posiljatelj: String {
        let bezAdrese = sender.replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
        let ocisceno = bezAdrese.trimmingCharacters(in: .whitespacesAndNewlines)
        return ocisceno.isEmpty ? sender : ocisceno
    }
}

// MARK: - Kalendar

struct Kalendar: Decodable {
    let days: [Dan]
    let total: Int
}

struct Dan: Decodable, Identifiable {
    let date: String
    let items: [Termin]
    var id: String { date }
}

struct Termin: Decodable {
    let allDay: Bool
    let start: String
    let end: String?
    let title: String
    let loc: String
    let desc: String
    let link: String?
}

// MARK: - Unos posla

struct NoviPosao: Encodable {
    var klijent = ""
    var projekt = ""
    var opis = ""
    var status = "Za napraviti"
    var prioritet = "Normalno"
    var rok: String?
    var vrijednost: Double?
    var napomena = ""

    static let statusi = ["Za napraviti", "U tijeku", "Čeka materijal/klijenta"]
    static let prioriteti = ["Hitno", "Visoko", "Normalno", "Nisko"]
}

struct UnosOdgovor: Decodable {
    let id: String
    let redak: Int
    let list: String
}
