import { Avatar } from '@/components/Avatar';
import { useProfilePhoto } from '@/src/profile/useProfilePhoto';

export function ProfileAvatar({
  userId,
  username,
  color,
  size,
  hasAvatar,
  borderColor,
  borderWidth,
}: {
  userId?: string | null;
  username: string;
  color: string;
  size: number;
  hasAvatar?: boolean | null;
  borderColor?: string;
  borderWidth?: number;
}) {
  const { uri } = useProfilePhoto(userId, hasAvatar);
  return (
    <Avatar
      uri={uri}
      username={username}
      color={color}
      size={size}
      borderColor={borderColor}
      borderWidth={borderWidth}
    />
  );
}
