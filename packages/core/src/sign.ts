import type { SignatureTag } from './generate';
import type { SignaturePart, SignerRole } from './types';

/**
 * Each provider finds signature positions by text it recognises in the
 * document. These are the tags Whereas writes where a signer signs.
 */
export type SignatureTagStyle = 'line' | 'docuseal' | 'docusign';

/** The anchor string DocuSign is told to look for. */
export function docusignAnchor(signer: SignerRole, part: SignaturePart): string {
  return `/wa_${part}_${signer.order}/`;
}

export function signatureTagFor(style: SignatureTagStyle): (signer: SignerRole, part: SignaturePart) => SignatureTag {
  return (signer, part) => {
    switch (style) {
      case 'docuseal': {
        const type = part === 'signature' ? 'signature' : part === 'initials' ? 'initials' : 'date';
        const name = part === 'signature' ? 'Signature' : part === 'initials' ? 'Initials' : 'Date';
        return { text: `{{${name};role=${signer.label};type=${type}}}` };
      }
      case 'docusign':
        return { text: docusignAnchor(signer, part), hidden: true };
      default:
        return {
          text: part === 'signature' ? '______________________________' : part === 'initials' ? '________' : '________________',
        };
    }
  };
}
