import SwiftUI

struct PultView: View {
    @EnvironmentObject var api: API
    @State private var pult: Pult?
    @State private var greska: String?
    @State private var ucitava = false
    @State private var noviPosao = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let greska { PorukaGreske(tekst: greska) }

                    if let pult {
                        Brojke(pult: pult)
                        Racuni(pult: pult)
                        ZaFakturirati(pult: pult)
                        OtvoreniPoslovi(pult: pult)
                        GrafPrimitaka(primici: pult.income)
                    } else if ucitava {
                        ProgressView().padding(.top, 60)
                    }
                }
                .padding(14)
            }
            .background(Boja.pozadina)
            .navigationTitle("Pult")
            .refreshable { await ucitaj(osvjezi: true) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { noviPosao = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Novi posao")
                }
            }
            .sheet(isPresented: $noviPosao) {
                NoviPosaoView { Task { await ucitaj(osvjezi: true) } }
            }
        }
        .task { await ucitaj() }
    }

    private func ucitaj(osvjezi: Bool = false) async {
        ucitava = true
        defer { ucitava = false }
        do {
            pult = try await api.dohvatiPult(osvjezi: osvjezi)
            greska = nil
        } catch {
            greska = error.localizedDescription
        }
    }
}

// MARK: - Dijelovi

private struct Brojke: View {
    let pult: Pult

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            Brojka(
                naslov: "Za naplatiti",
                vrijednost: Format.eur(pult.totals.dueSum),
                nota: pult.totals.overdueCount > 0
                    ? "\(pult.totals.overdueCount) kasni · \(Format.eur(pult.totals.dueOverdue, decimale: 0)) preko roka"
                    : "\(pult.due.count) otvorenih računa",
                istaknuto: true,
                notaKriticna: pult.totals.overdueCount > 0
            )
            Brojka(
                naslov: "Otvoreni poslovi",
                vrijednost: "\(pult.open.count)",
                nota: "vrijednost \(Format.eur(pult.totals.openValue, decimale: 0))"
            )
            Brojka(
                naslov: "Za fakturirati",
                vrijednost: "\(pult.toInvoice.count)",
                nota: pult.toInvoice.isEmpty ? "sve je fakturirano" : Format.eur(pult.totals.invoiceSum, decimale: 0)
            )
            Brojka(
                naslov: "Naplaćeno",
                vrijednost: Format.eur(pult.income.paidTotal, decimale: 0),
                nota: "svi primici"
            )
        }
    }
}

private struct Brojka: View {
    let naslov: String
    let vrijednost: String
    let nota: String
    var istaknuto = false
    var notaKriticna = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(naslov.uppercased())
                .font(.caption2.weight(.semibold)).kerning(0.6)
                .foregroundStyle(Boja.tekst2)
            Text(vrijednost)
                .font(.title2.weight(.bold))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(nota)
                .font(.caption2)
                .foregroundStyle(notaKriticna ? Boja.kriticno : Boja.tekst2)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Boja.ploha, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(istaknuto ? Boja.akcent : Boja.linija, lineWidth: 1)
        )
    }
}

private struct Racuni: View {
    let pult: Pult

    var body: some View {
        Kartica(naslov: "Računi za naplatiti", podnaslov: "\(pult.due.count) računa") {
            if pult.due.isEmpty {
                Text("Nema računa za naplatiti.").font(.footnote).foregroundStyle(Boja.tekst2)
            }
            ForEach(pult.due) { r in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(r.no).font(.footnote.monospaced().weight(.medium))
                        oznakaRoka(r)
                        Spacer()
                        Text(Format.eur(r.amount)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    }
                    Text(r.client).font(.subheadline)
                    if let rok = r.rok {
                        Text("rok \(Format.punDatum(rok))").font(.caption).foregroundStyle(Boja.tekst3)
                    }
                }
                .padding(.vertical, 6)
                Divider().opacity(r.id == pult.due.last?.id ? 0 : 1)
            }
            if !pult.cancelled.isEmpty {
                Text("Poništeno stornom: " + pult.cancelled.map { "\($0.racun) ↔ \($0.storno)" }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(Boja.tekst3)
            }
        }
    }

    @ViewBuilder
    private func oznakaRoka(_ r: Racun) -> some View {
        if r.storno {
            Oznaka(tekst: "storno")
        } else if let late = r.late {
            if late > 0 {
                Oznaka(tekst: "kasni \(late) d", boja: Boja.kriticno)
            } else if late == 0 {
                Oznaka(tekst: "rok danas", boja: Boja.upozorenje)
            } else if late >= -3 {
                Oznaka(tekst: "za \(-late) d", boja: Boja.upozorenje)
            } else {
                Oznaka(tekst: "za \(-late) d", boja: Boja.dobro)
            }
        } else {
            Oznaka(tekst: "bez roka")
        }
    }
}

private struct ZaFakturirati: View {
    let pult: Pult

    var body: some View {
        if !pult.toInvoice.isEmpty {
            Kartica(naslov: "Za fakturirati", podnaslov: Format.eur(pult.totals.invoiceSum, decimale: 0)) {
                ForEach(pult.toInvoice) { j in
                    RedakPosla(posao: j)
                    Divider().opacity(j.id == pult.toInvoice.last?.id ? 0 : 1)
                }
            }
        }
    }
}

private struct OtvoreniPoslovi: View {
    let pult: Pult

    var body: some View {
        Kartica(naslov: "Otvoreni poslovi", podnaslov: "\(pult.open.count) poslova") {
            if pult.open.isEmpty {
                Text("Nema otvorenih poslova.").font(.footnote).foregroundStyle(Boja.tekst2)
            }
            ForEach(pult.open) { j in
                RedakPosla(posao: j)
                Divider().opacity(j.id == pult.open.last?.id ? 0 : 1)
            }
        }
    }
}

private struct RedakPosla: View {
    let posao: Posao

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if posao.prio == "Hitno" { Oznaka(tekst: "hitno", boja: Boja.kriticno) }
                else if posao.prio == "Visoko" { Oznaka(tekst: "visoko", boja: Boja.upozorenje) }
                if posao.status != "Za napraviti" { Oznaka(tekst: posao.status.lowercased()) }
                Spacer()
                if let iznos = posao.iznos {
                    Text(Format.eur(iznos, decimale: 0)).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
            Text("\(posao.client) · \(posao.proj)").font(.subheadline.weight(.medium))
            if !posao.desc.isEmpty {
                Text(posao.desc).font(.caption).foregroundStyle(Boja.tekst2)
            }
            if let rok = posao.rok {
                Text("rok \(Format.punDatum(rok))").font(.caption).foregroundStyle(Boja.tekst3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
    }
}

private struct GrafPrimitaka: View {
    let primici: Primici

    private var najveci: Double { max(primici.byMonth.map(\.iznos).max() ?? 1, 1) }

    var body: some View {
        if !primici.byMonth.isEmpty {
            Kartica(naslov: "Primici po mjesecu", podnaslov: Format.eur(primici.paidTotal, decimale: 0)) {
                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(primici.byMonth.indices, id: \.self) { index in
                        let m = primici.byMonth[index]
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(index == primici.byMonth.count - 1 ? Boja.akcent : Boja.akcent.opacity(0.45))
                                .frame(height: max(4, 90 * m.iznos / najveci))
                            Text(Self.kraticaMjeseca(m.mjesec))
                                .font(.system(size: 9))
                                .foregroundStyle(Boja.tekst3)
                        }
                    }
                }
                .frame(height: 110, alignment: .bottom)
            }
        }
    }

    private static let mjeseci = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"]

    static func kraticaMjeseca(_ kljuc: String) -> String {
        guard let broj = Int(kljuc.suffix(2)), (1...12).contains(broj) else { return kljuc }
        return mjeseci[broj - 1]
    }
}

struct PorukaGreske: View {
    let tekst: String

    var body: some View {
        Text(tekst)
            .font(.footnote)
            .foregroundStyle(Boja.kriticno)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Boja.kriticno.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}
