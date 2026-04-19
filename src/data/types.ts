export interface PPtr {
    m_FileID: number;
    m_PathID: string;
}

export interface MonoBehaviour {
    m_Enabled: number;
    m_GameObject: PPtr;
    m_Name: string;
    m_Script: PPtr;
}

export interface AnimatedObjectDefinition extends MonoBehaviour {
    defaultAnimationName: string;
    defaultAnimationLoops: number;
    defaultFrameRate: number;
    maxNodeCount: number;
    exposedNodeNames: string[];
    maskableNodes: MaskableNode[];
    boneAsset: PPtr;
    graphics: SkinAssetPartPair[];
    animations: Animation[];
    blankAnimations: string[];
}

export interface SkinAssetPartPair {
    asset: PPtr;
    part: SkinAssetPart;
}

export interface SkinAssetPart {
    name: string;
    DisplayListEntry: DisplayListEntry[];
    skinChunks: SkinChunk[];
}

export interface MaskableNode {
    name: string;
    graphicSymbolId: string;
}

export interface Animation {
    name: string;
    data: PPtr;
    dataBytes: number[];
    bounds: Rectf;
}

export interface Rectf {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
}

export interface SkinAsset extends MonoBehaviour {
    m_keys: string[];
    m_values: SkinAssetPart[];
    triangles: number[];
    vertices: AnimationGeometryVertex[];
    referencedSymbols: string[];
    emptyCustomisations: string[];
    textures: PPtr[];
}

export interface AnimationGeometryVertex {
    pos: Vector3f;
    uv: Vector2f;
    multiplicativeColor: number;
    additiveColor: number;
}

export interface Vector2f {
    x: number;
    y: number;
}

export interface Vector3f {
    x: number;
    y: number;
    z: number;
}

export interface DisplayListEntry {
    symbolId: number;
    entries: number;
    transform: AnimTransform;
}

export interface AnimTransform {
    rX: number;
    uX: number;
    rY: number;
    uY: number;
    tX: number;
    tY: number;
}

export interface SkinChunk {
    startVertexIndex: number;
    indexCount: number;
    startIndexIndex: number;
    vertexCount: number;
    textureIndex: number;
    maskState: number;
}

export interface I18n {
    fr: string;
    en: string;
    de: string;
    es: string;
    pt: string;
    id: number;
}

export interface MetadataRoot<T> extends MonoBehaviour {
    objectsById: Record<string, T>;
}


export interface BodyData {
    id: number;
    skins: string;
    assetId: string;
    breed: number;
    gender: number;
    label: string;
    order: number;
    payable: boolean;
    availableAtCreation: boolean;
    nameId: I18n;
}

export type BodiesDataRoot = MetadataRoot<BodyData>;

export enum SkinSlotRuleType {
    Default = 0,
    Breed = 1,
    BreedAndSex = 2,
    Face = 3,
}

export interface SlotRuleData {
    id: number;
    mask: number;
}

export interface SkinSlotsRulesInfoData {
    slotRuleType: SkinSlotRuleType;
    slotRuleInfo: number;
    slotsRules: SlotRuleData[];
}

export interface SkinSlotRuleData {
    skinId: number;
    slotRulesList: SkinSlotsRulesInfoData[];
}

export type SkinSlotsRulesDataRoot = MetadataRoot<SkinSlotRuleData>;

export interface SkinBundle {
    skin: SkinAsset;
    images: ImageBitmap[];
}

export interface BoneBundle {
    bone: AnimatedObjectDefinition;
    skin: SkinBundle;
}
