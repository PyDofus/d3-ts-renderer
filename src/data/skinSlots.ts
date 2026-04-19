import type {BodyData, SkinSlotRuleData, SlotRuleData} from './types.js';
import {DataLoader, loader} from './loader.js';

const enum SkinSlotRuleType {
    Default = 0,
    Breed = 1,
    BreedAndSex = 2,
    Face = 3,
}

const enum SlotEnum {
    Bandeau_ = 0,
    BandeauB_ = 1,
    Barbe_ = 2,
    Chapeau_ = 3,
    ChapeauB_ = 4,
    cheveux_ = 5,
    Frange_ = 20,
    Custo_ = 6,
    Oreille_d_ = 7,
    Oreille_g_ = 8,
    Oreille_ = 9,
    Oreille_b_ = 10,
    Masque_ = 11,
    MasqueB_ = 12,
    NatteHaute_ = 13,
    Natte_ = 16,
    NatteB_ = 17,
    Natte_Basse_ = 19,
    Patte_d_ = 14,
    Patte_g_ = 15,
    Patte_0 = 18,
    Tete_OL_ = 21,
}

const slotEnumNames: Readonly<Record<number, string>> = {
    0: 'Bandeau_', 1: 'BandeauB_', 2: 'Barbe_', 3: 'Chapeau_', 4: 'ChapeauB_',
    5: 'cheveux_', 20: 'Frange_', 6: 'Custo_', 7: 'Oreille_d_', 8: 'Oreille_g_',
    9: 'Oreille_', 10: 'Oreille_b_', 11: 'Masque_', 12: 'MasqueB_', 13: 'NatteHaute_',
    16: 'Natte_', 17: 'NatteB_', 19: 'Natte_Basse_', 14: 'Patte_d_', 15: 'Patte_g_',
    18: 'Patte_0', 21: 'Tete_OL_',
};

type SlotSkin = Map<number, Map<number, SlotRuleData[]>>

class SkinSlot {
    private readonly _slotRules: Map<number, SlotSkin>;

    private constructor(data: Record<string, SkinSlotRuleData>) {
        this._slotRules = new Map<number, SlotSkin>();
        for (const entry of Object.values(data)) {
            const skinRules: SlotSkin = new Map();
            for (const elem of entry.slotRulesList) {
                let byType = skinRules.get(elem.slotRuleType);
                if (!byType) {
                    byType = new Map<number, SlotRuleData[]>();
                    skinRules.set(elem.slotRuleType, byType);
                }
                byType.set(elem.slotRuleInfo, elem.slotsRules)
            }
            this._slotRules.set(entry.skinId, skinRules);
        }
    }

    static async create(loader: DataLoader): Promise<SkinSlot> {
        const data = await loader.loadSkinSlots();
        return new SkinSlot(data);
    }

    slotFromBody(skins: readonly number[], body: BodyData | undefined): ReadonlySet<string> {
        if (skins.length <= 2 || body === undefined) return new Set();
        return this.getSkinSlot(skins.slice(2), body.breed, body.gender, skins[1]!);
    }

    getSkinSlot(skins: readonly number[], breed: number, sex: number, face: number): Set<string> {
        const breedAndSex = 2 * breed + sex;
        const slotSet = new Set<string>();
        const rules: Array<[SkinSlotRuleType, number]> = [
            [SkinSlotRuleType.Face, face],
            [SkinSlotRuleType.BreedAndSex, breedAndSex],
            [SkinSlotRuleType.Breed, breed],
            [SkinSlotRuleType.Default, 0],
        ];

        for (const skin of skins) {
            const skinData = this._slotRules.get(skin);
            if (!skinData) continue;
            const slot = this.#slotFromRules(skinData, rules);
            if (slot) this.#updateSlotSet(slot, slotSet);
        }
        return slotSet;
    }

    #slotFromRules(slotSkin: SlotSkin, rules: Array<[SkinSlotRuleType, number]>): SlotRuleData[] | undefined {
        for (const [ruleType, key] of rules) {
            const slot = slotSkin.get(ruleType)?.get(key);
            if (slot) return slot;
        }
        return undefined;
    }

    #updateSlotSet(slotRules: SlotRuleData[], slotSet: Set<string>): void {
        for (const slotRule of slotRules) {
            const skipTest = (slotRule.mask & 1) === 0;
            for (let i = 0; i < 5; i++) {
                if (skipTest || (slotRule.mask & (1 << ((i + 1) & 0x1f))) === 0) {
                    const index = i > 2 ? i + 2 : i;
                    const name = slotEnumNames[slotRule.id];
                    if (name) slotSet.add(`${name}${index}`);
                }
            }
        }
    }
}

export const skinSlots = await SkinSlot.create(loader)
