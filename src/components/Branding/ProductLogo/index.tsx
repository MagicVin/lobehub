'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { type LobeHubProps } from '@lobehub/ui/brand';
import { LobeHub } from '@lobehub/ui/brand';
import { memo } from 'react';

import CustomLogo from './Custom';

interface ProductLogoProps extends LobeHubProps {
  height?: number;
  width?: number;
}

export const ProductLogo = memo<ProductLogoProps>((props) => {
  if (BRANDING_NAME !== 'LobeHub') {
    return <CustomLogo {...props} />;
  }

  return <LobeHub {...props} />;
});
