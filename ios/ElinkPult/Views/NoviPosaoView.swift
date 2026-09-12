import SwiftUI

/// Unos posla s terena — upisuje redak izravno u tablicu "Radovi".
struct NoviPosaoView: View {
    @EnvironmentObject var api: API
    @Environment(\.dismiss) private var zatvori

    private let nakonUpisa: () -> Void

    init(nakonUpisa: @escaping () -> Void) {
        self.nakonUpisa = nakonUpisa
    }

    @State private var posao = NoviPosao()
    @State private var imaRok = false
    @State private var rok = Date()
    @State private var vrijednostTekst = ""
    @State private var greska: String?
    @State private var upisuje = false

    private var ispravno: Bool {
        !posao.klijent.trimmingCharacters(in: .whitespaces).isEmpty &&
        !posao.projekt.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Klijent", text: $posao.klijent)
                    TextField("Projekt / posao", text: $posao.projekt)
                    TextField("Sljedeći korak", text: $posao.opis, axis: .vertical)
                        .lineLimit(2...5)
                }

                Section {
                    Picker("Status", selection: $posao.status) {
                        ForEach(NoviPosao.statusi, id: \.self) { Text($0) }
                    }
                    Picker("Prioritet", selection: $posao.prioritet) {
                        ForEach(NoviPosao.prioriteti, id: \.self) { Text($0) }
                    }
                }

                Section {
                    Toggle("Ima rok", isOn: $imaRok)
                    if imaRok {
                        DatePicker("Rok", selection: $rok, displayedComponents: .date)
                            .environment(\.locale, Format.hr)
                    }
                    TextField("Vrijednost (€)", text: $vrijednostTekst)
                        .keyboardType(.decimalPad)
                }

                Section {
                    TextField("Napomena", text: $posao.napomena, axis: .vertical)
                        .lineLimit(1...4)
                }

                if let greska {
                    Section { Text(greska).font(.footnote).foregroundStyle(Boja.kriticno) }
                }
            }
            .navigationTitle("Novi posao")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Odustani") { zatvori() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await upisi() }
                    } label: {
                        if upisuje { ProgressView() } else { Text("Spremi") }
                    }
                    .disabled(!ispravno || upisuje)
                }
            }
        }
    }

    private func upisi() async {
        greska = nil
        upisuje = true
        defer { upisuje = false }

        var zaSlanje = posao
        zaSlanje.klijent = posao.klijent.trimmingCharacters(in: .whitespaces)
        zaSlanje.projekt = posao.projekt.trimmingCharacters(in: .whitespaces)
        zaSlanje.rok = imaRok ? Self.isoDan(rok) : nil

        let ocisceno = vrijednostTekst.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if !ocisceno.isEmpty {
            guard let broj = Double(ocisceno) else {
                greska = "Vrijednost mora biti broj."
                return
            }
            zaSlanje.vrijednost = broj
        }

        do {
            _ = try await api.upisiPosao(zaSlanje)
            nakonUpisa()
            zatvori()
        } catch {
            greska = error.localizedDescription
        }
    }

    /// Poslužitelj očekuje GGGG-MM-DD u lokalnom danu.
    static func isoDan(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
