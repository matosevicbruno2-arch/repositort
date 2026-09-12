import SwiftUI
import UIKit

struct KalendarView: View {
    @EnvironmentObject var api: API
    @State private var kalendar: Kalendar?
    @State private var greska: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let greska { PorukaGreske(tekst: greska) }

                    if let kalendar {
                        ForEach(kalendar.days.indices, id: \.self) { index in
                            let dan = kalendar.days[index]
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(Format.naslovDana(dan.date))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(index == 0 ? Boja.akcent : Boja.tekst2)
                                    if index == 0 {
                                        Text("danas").font(.caption).foregroundStyle(Boja.akcent)
                                    }
                                }
                                if dan.items.isEmpty {
                                    Text("—").font(.footnote).foregroundStyle(Boja.tekst3)
                                } else {
                                    ForEach(dan.items.indices, id: \.self) { i in
                                        RedakTermina(termin: dan.items[i])
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(14)
            }
            .background(Boja.pozadina)
            .navigationTitle("Kalendar")
            .refreshable { await ucitaj(osvjezi: true) }
        }
        .task { await ucitaj() }
    }

    private func ucitaj(osvjezi: Bool = false) async {
        do {
            kalendar = try await api.dohvatiKalendar(osvjezi: osvjezi)
            greska = nil
        } catch {
            greska = error.localizedDescription
        }
    }
}

private struct RedakTermina: View {
    let termin: Termin

    private var vrijeme: String {
        if termin.allDay { return "cijeli dan" }
        guard let pocetak = Format.trenutak(termin.start) else { return "" }
        let kraj = Format.trenutak(termin.end)
        return Format.vrijeme(pocetak) + (kraj.map { "–" + Format.vrijeme($0) } ?? "")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(termin.allDay ? Boja.linija : Boja.akcent)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 2) {
                Text(vrijeme).font(.caption.monospaced()).foregroundStyle(Boja.tekst2)
                Text(termin.title).font(.subheadline.weight(.medium))
                if !termin.loc.isEmpty {
                    Text(termin.loc).font(.caption).foregroundStyle(Boja.tekst3)
                }
                if !termin.desc.isEmpty {
                    Text(termin.desc).font(.caption).foregroundStyle(Boja.tekst3).lineLimit(2)
                }
            }
            Spacer()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Boja.ploha2, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture {
            if let link = termin.link, let url = URL(string: link) { UIApplication.shared.open(url) }
        }
    }
}
