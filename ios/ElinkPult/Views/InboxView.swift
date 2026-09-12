import SwiftUI
import UIKit

struct InboxView: View {
    @EnvironmentObject var api: API
    @State private var poruke: [Poruka] = []
    @State private var filter = "sve"
    @State private var greska: String?
    @State private var ucitava = false

    private struct Kategorija: Identifiable {
        let id: String
        let naziv: String
        let boja: Color
    }

    private let kategorije = [
        Kategorija(id: "sve", naziv: "Sve", boja: Boja.akcent),
        Kategorija(id: "klijenti", naziv: "Klijenti", boja: Boja.akcent),
        Kategorija(id: "financije", naziv: "Financije", boja: Boja.upozorenje),
        Kategorija(id: "upozorenja", naziv: "Upozorenja", boja: Boja.kriticno),
        Kategorija(id: "ostalo", naziv: "Ostalo", boja: Boja.tekst2)
    ]

    private var prikazane: [Poruka] {
        filter == "sve" ? poruke : poruke.filter { $0.cat == filter }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(kategorije) { k in
                                let broj = k.id == "sve" ? poruke.count : poruke.filter { $0.cat == k.id }.count
                                Button {
                                    filter = k.id
                                } label: {
                                    Text(poruke.isEmpty ? k.naziv : "\(k.naziv) \(broj)")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 10).padding(.vertical, 5)
                                        .background(k.boja.opacity(filter == k.id ? 0.25 : 0.12), in: Capsule())
                                        .foregroundStyle(k.boja)
                                        .overlay(Capsule().stroke(filter == k.id ? k.boja : .clear, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 14)
                    }

                    if let greska { PorukaGreske(tekst: greska).padding(.horizontal, 14) }

                    if prikazane.isEmpty && !ucitava {
                        Text("Nema poruka u ovoj kategoriji.")
                            .font(.footnote).foregroundStyle(Boja.tekst2)
                            .padding(.top, 40)
                    }

                    LazyVStack(spacing: 0) {
                        ForEach(prikazane) { p in
                            RedakPoruke(poruka: p)
                            Divider().padding(.leading, 14)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .background(Boja.pozadina)
            .navigationTitle("Inbox")
            .refreshable { await ucitaj(osvjezi: true) }
        }
        .task { await ucitaj() }
    }

    private func ucitaj(osvjezi: Bool = false) async {
        ucitava = true
        defer { ucitava = false }
        do {
            poruke = try await api.dohvatiInbox(osvjezi: osvjezi)
            greska = nil
        } catch {
            greska = error.localizedDescription
        }
    }
}

private struct RedakPoruke: View {
    let poruka: Poruka

    private var boja: Color {
        switch poruka.cat {
        case "upozorenja": return Boja.kriticno
        case "financije": return Boja.upozorenje
        case "klijenti": return Boja.akcent
        default: return Boja.linija
        }
    }

    private var poveznica: URL? {
        URL(string: "https://mail.google.com/mail/u/0/#inbox/\(poruka.id)")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(boja)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(poruka.posiljatelj + (poruka.count > 1 ? " · \(poruka.count)" : ""))
                        .font(.caption).foregroundStyle(Boja.tekst2).lineLimit(1)
                    Spacer()
                    Text(Format.kada(poruka.date)).font(.caption2).foregroundStyle(Boja.tekst3)
                }
                Text(poruka.subject)
                    .font(.subheadline.weight(poruka.unread ? .semibold : .regular))
                    .lineLimit(2)
                Text(poruka.snippet)
                    .font(.caption).foregroundStyle(Boja.tekst3).lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .onTapGesture {
            if let poveznica { UIApplication.shared.open(poveznica) }
        }
    }
}
