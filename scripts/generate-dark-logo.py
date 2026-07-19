import os
from PIL import Image
import numpy as np

os.makedirs('public/img', exist_ok=True)
im = Image.open('public/img/aceddivision-Logo-Icon.png').convert('RGBA')
arr = np.array(im).astype(float)
rgb, alpha = arr[..., :3], arr[..., 3]

gold, black = np.array([222, 143, 0]), np.array([0, 0, 0])
is_gold = np.linalg.norm(rgb - gold, axis=2) < np.linalg.norm(rgb - black, axis=2)

cream, ember = np.array([243, 241, 236]), np.array([232, 169, 96])
out = np.zeros_like(arr, dtype=np.uint8)
out[..., :3] = np.where(is_gold[..., None], ember, cream)
out[..., 3] = alpha.astype(np.uint8)
Image.fromarray(out, 'RGBA').save('public/img/aceddivision-Logo-Icon-OnDark.png')

# Fully single-colour gold variant (for favicon / tight spaces)
out_gold = np.zeros_like(arr, dtype=np.uint8)
out_gold[..., :3] = np.array([201, 150, 44])
out_gold[..., 3] = alpha.astype(np.uint8)
Image.fromarray(out_gold, 'RGBA').save('public/img/aceddivision-Logo-Icon-Gold.png')
