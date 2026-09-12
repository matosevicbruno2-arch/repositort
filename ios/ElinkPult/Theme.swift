import SwiftUI
import UIKit

/// Boje preuzete s web pulta, da aplikacija izgleda kao isti proizvod.
enum Boja {
    static let akcent = Color(light: 0x0F6E8C, dark: 0x4FB3D1)
    static let pozadina = Color(light: 0xF2F4F6, dark: 0x14181E)
    static let ploha = Color(light: 0xFFFFFF, dark: 0x1C2229)
    static let ploha2 = Color(light: 0xE9EDF1, dark: 0x232B34)
    static let linija = Color(light: 0xD5DBE2, dark: 0x2E3843)
    static let tekst = Color(light: 0x1B2430, dark: 0xE8ECF0)
    static let tekst2 = Color(light: 0x5C6774, dark: 0xA5AFBA)
    static let tekst3 = Color(light: 0x8A94A0, dark: 0x6F7A86)
    static let dobro = Color(light: 0x2E7D4F, dark: 0x6CC391)
    static let upozorenje = Color(light: 0xB7791F, dark: 0xE0B15A)
    static let kriticno = Color(light: 0xC2410C, dark: 0xF0895C)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/** Oznaka u boji, kao "chip" na webu. */
struct Oznaka: View {
    let tekst: String
    var boja: Color = Boja.tekst2

    var body: some View {
        Text(tekst)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(boja.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(boja)
    }
}

/** Kartica s naslovom, osnovni gradivni element zaslona. */
struct Kartica<Sadrzaj: View>: View {
    private let naslov: String
    private let podnaslov: String?
    private let sadrzaj: Sadrzaj

    init(naslov: String, podnaslov: String? = nil, @ViewBuilder sadrzaj: () -> Sadrzaj) {
        self.naslov = naslov
        self.podnaslov = podnaslov
        self.sadrzaj = sadrzaj()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(naslov.uppercased())
                    .font(.caption.weight(.semibold))
                    .kerning(0.8)
                    .foregroundStyle(Boja.tekst2)
                Spacer()
                if let podnaslov {
                    Text(podnaslov).font(.caption).foregroundStyle(Boja.tekst3)
                }
            }
            sadrzaj
        }
        .padding(14)
        .background(Boja.ploha, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Boja.linija, lineWidth: 1))
    }
}
